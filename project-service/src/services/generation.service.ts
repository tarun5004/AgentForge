import { requestProjectGeneration } from "../clients/ai-orchestrator.client.js";
import { AppError } from "../middlewares/error.middleware.js";
import type { GenerationResult } from "../models/generation.model.js";
import {
  findGenerationByKey,
  insertPendingGeneration,
  isGenerationKeyDuplicate,
  type GenerationReadRecord,
  markGenerationFailed,
  markGenerationReady,
  saveGenerationResult,
} from "../repositories/generation.repository.js";
import {
  findOwnedProject,
  reserveNextRevisionNumber,
  setProjectStatus,
} from "../repositories/project.repository.js";
import {
  findLatestRevision,
  findProjectRevision,
  findRevisionForGeneration,
  insertRevision,
  type RevisionReadRecord,
} from "../repositories/revision.repository.js";
import {
  createGenerationIntent,
  validateGenerationBody,
  validateIdempotencyKey,
} from "./generation-request.js";
import { validateObjectId } from "./project-read.validation.js";

// Build a public response from the committed snapshot, not from a stale pointer/status.
// Explicit fields keep database implementation details out of the browser response.
function formatCompletedGeneration(generation: GenerationReadRecord, revision: RevisionReadRecord) {
  if (!generation.result) {
    throw new AppError(
      503,
      "Saved generation metadata is unavailable. Retry with the same key.",
      "OUTCOME_UNKNOWN",
      generation._id.toString(),
    );
  }

  return {
    id: String(generation._id),
    status: "ready" as const,
    revisionId: revision._id.toString(),
    revisionVersion: revision.version,
    provider: generation.result.provider,
    model: generation.result.model,
    summary: revision.summary,
    files: revision.files.map((file) => ({ path: file.path, content: file.content })),
    usage: {
      inputTokens: generation.result.usage.inputTokens,
      outputTokens: generation.result.usage.outputTokens,
      totalTokens: generation.result.usage.totalTokens,
    },
    latencyMs: generation.result.latencyMs,
  };
}

// Resolve an existing attempt before deciding whether a NEW generation is allowed.
// This prevents refresh/retry from spending tokens twice or hiding an already-saved revision.
// Internal callers must already have checked project ownership and loaded this owned attempt.
export async function replayGeneration(
  generation: GenerationReadRecord,
  fingerprint: string,
  emptyBody: boolean,
) {
  const matches = generation.requestFingerprint
    ? generation.requestFingerprint === fingerprint
    : emptyBody; // Legacy attempts have no fingerprint; only their original empty request is verifiable.
  if (!matches) {
    throw new AppError(
      409,
      "This Idempotency-Key was already used with different input.",
      "IDEMPOTENCY_MISMATCH",
      generation._id.toString(),
    );
  }

  const revision = await findRevisionForGeneration(generation.projectId.toString(), generation._id.toString());
  if (revision) {
    // A pending snapshot may be older than the revision we just found. Refresh metadata once,
    // rather than returning false uncertainty while the winner has already saved its output.
    let recorded = generation;
    if (!recorded.result) {
      const refreshed = await findGenerationByKey(
        generation.projectId.toString(), generation.ownerId, generation.idempotencyKey,
      );
      if (refreshed?._id.toString() === generation._id.toString()) recorded = refreshed;
    }
    return formatCompletedGeneration(recorded, revision);
  }

  if (generation.status === "ready") {
    throw new AppError(
      503,
      "The saved revision could not be established. Retry with the same key.",
      "OUTCOME_UNKNOWN",
      generation._id.toString(),
    );
  }
  if (generation.status === "failed") {
    throw new AppError(
      409,
      "This generation failed. Send a new Idempotency-Key to retry.",
      "GENERATION_FAILED",
      generation._id.toString(),
    );
  }
  throw new AppError(
    409,
    "This generation is pending and has no saved revision yet.",
    "GENERATION_IN_PROGRESS",
    generation._id.toString(),
  );
}

// Coordinate one owned request: validate -> identify/replay -> save pending -> call AI -> save output.
// Keeping this sequence in the service leaves the controller small and prevents duplicate token spend.
export async function createGeneration(
  ownerId: string,
  rawProjectId: unknown,
  idempotencyHeader: unknown,
  rawBody: unknown = undefined,
) {
  const projectId = validateObjectId(rawProjectId, "projectId");
  const idempotencyKey = validateIdempotencyKey(idempotencyHeader);
  const body = validateGenerationBody(rawBody);
  const project = await findOwnedProject(projectId, ownerId);

  if (!project) {
    throw new AppError(404, "Project not found.");
  }

  const intent = createGenerationIntent(projectId, project.initialPrompt, body);
  const emptyBody = Object.keys(body).length === 0;
  const existingGeneration = await findGenerationByKey(
    projectId,
    ownerId,
    idempotencyKey,
  );

  if (existingGeneration) {
    return replayGeneration(existingGeneration, intent.requestFingerprint, emptyBody);
  }

  // Do not pretend to apply a base until the AI context/merge contract is implemented.
  if (intent.baseRevisionId) {
    const base = await findProjectRevision(projectId, intent.baseRevisionId);
    if (!base) throw new AppError(404, "Revision not found.");
    throw new AppError(409, "Follow-up generation is not available yet.", "FOLLOW_UP_NOT_AVAILABLE");
  }
  const head = await findLatestRevision(projectId);
  if (head) {
    // The winner may have finished between our first key lookup and this head read.
    // Recheck before rejecting a retry as a new request against an existing revision.
    const winner = await findGenerationByKey(projectId, ownerId, idempotencyKey);
    if (winner) return replayGeneration(winner, intent.requestFingerprint, emptyBody);
    throw new AppError(400, "A new generation requires a change prompt and baseRevisionId.", "BASE_REVISION_REQUIRED");
  }

  // The unique index is the final race guard: both requests can pass the earlier lookup.
  // Only the insert winner calls AI; the loser rereads and resolves the same saved attempt.
  let generation: GenerationReadRecord;
  try {
    generation = await insertPendingGeneration({
      projectId,
      ownerId,
      idempotencyKey,
      ...intent,
      expectedVersion: 1, // Initial-only for now; captured version becomes authoritative in publication work.
      requestPolicyVersion: "generation-request-v1",
    });
  } catch (error) {
    if (!isGenerationKeyDuplicate(error)) throw error;
    const winner = await findGenerationByKey(projectId, ownerId, idempotencyKey);
    if (!winner) throw new AppError(503, "Generation outcome is unknown. Retry with the same key.", "OUTCOME_UNKNOWN");
    return replayGeneration(winner, intent.requestFingerprint, emptyBody);
  }
  const generationId = generation._id.toString();
  await setProjectStatus(projectId, "generating");

  try {
    const aiResult = await requestProjectGeneration({
      requestId: generationId,
      projectId,
      prompt: intent.sourcePrompt,
    });
    const savedResult: GenerationResult = {
      provider: aiResult.provider,
      model: aiResult.model,
      summary: aiResult.summary,
      // Persist our independently validated full snapshot, never raw changed-file output.
      files: aiResult.snapshot.files,
      usage: aiResult.usage,
      latencyMs: aiResult.latencyMs,
    };

    // Save the model result before publishing a revision so paid output is never lost.
    await saveGenerationResult(generationId, savedResult);

    const version = await reserveNextRevisionNumber(projectId);
    const revision = await insertRevision({
      projectId,
      generationId,
      version,
      summary: savedResult.summary,
      files: savedResult.files,
    });

    await markGenerationReady(generationId, revision._id.toString());
    await setProjectStatus(projectId, "ready");

    return {
      id: generationId,
      status: "ready" as const,
      revisionId: revision._id.toString(),
      revisionVersion: version,
      ...savedResult,
    };
  } catch (error) {
    await markGenerationFailed(generationId, "AI_GENERATION_FAILED");
    await setProjectStatus(projectId, "failed");
    throw new AppError(502, "Code generation failed. Please try again.");
  }
}
