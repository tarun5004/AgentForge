import { requestProjectGeneration } from "../clients/ai-orchestrator.client.js";
import { env } from "../config/env.js";
import { matchingBuildVerification } from "../clients/build-verification.js";
import { queueCandidatePublication } from "./generation.build-gate.js";
import { AppError } from "../middlewares/error.middleware.js";
import type { GenerationResult } from "../models/generation.model.js";
import { prepareGenerationRequest, type GenerationInput } from "../clients/generation.contract.js";
import {
  findGenerationByKey,
  findOwnedGeneration,
  insertPendingGeneration,
  isGenerationKeyDuplicate,
  type GenerationReadRecord,
  saveGenerationResult,
} from "../repositories/generation.repository.js";
import {
  findOwnedProject,
  setProjectStatus,
} from "../repositories/project.repository.js";
import {
  findLatestRevision,
  findProjectRevision,
  findRevisionForGeneration,
  type RevisionReadRecord,
} from "../repositories/revision.repository.js";
import {
  createGenerationIntent,
  validateGenerationBody,
  validateIdempotencyKey,
} from "./generation-request.js";
import { assertReadResponseSize, validateObjectId, validateQueryKeys } from "./project-read.validation.js";
import {
  logGenerationBookkeepingFailure, publishGeneration, recordGenerationFailure,
  repairPublishedGeneration, unknownGenerationOutcome,
} from "./generation.publication.js";

// Build a public response from the committed snapshot, not from a stale pointer/status.
// Explicit fields keep database implementation details out of the browser response.
function formatCompletedGeneration(generation: GenerationReadRecord, revision: RevisionReadRecord) {
  // New revisions carry their own metadata. Legacy revisions may use the linked Generation.
  const metadata = revision.provider && revision.model && revision.usage && typeof revision.latencyMs === "number"
    ? { provider: revision.provider, model: revision.model, usage: revision.usage, latencyMs: revision.latencyMs }
    : generation.result;
  if (!metadata) {
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
    parentRevisionId: revision.parentRevisionId?.toString() ?? null,
    sourcePrompt: revision.sourcePrompt ?? null,
    fileChanges: revision.fileChanges?.map((change) => ({ path: change.path, status: change.status })) ?? null,
    validation: revision.validation ? { policyVersion: revision.validation.policyVersion, status: revision.validation.status } : null,
    buildVerification: matchingBuildVerification(revision.buildVerification, revision.files),
    provider: metadata.provider,
    model: metadata.model,
    summary: revision.summary,
    files: revision.files.map((file) => ({ path: file.path, content: file.content })),
    usage: {
      inputTokens: metadata.usage.inputTokens,
      outputTokens: metadata.usage.outputTokens,
      totalTokens: metadata.usage.totalTokens,
    },
    latencyMs: metadata.latencyMs,
  };
}

// Resolve an existing attempt before deciding whether a NEW generation is allowed.
// This prevents refresh/retry from spending tokens twice or hiding an already-saved revision.
// Internal callers must already have checked project ownership and loaded this owned attempt.
export async function replayGeneration(
  generation: GenerationReadRecord,
  fingerprint: string,
  emptyBody: boolean,
  authorization = "",
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

  let revision: RevisionReadRecord | null;
  try { revision = await findRevisionForGeneration(generation.projectId.toString(), generation._id.toString()); }
  catch { throw unknownGenerationOutcome(generation._id.toString()); }
  if (revision) {
    // A pending snapshot may be older than the revision we just found. Refresh metadata once,
    // rather than returning false uncertainty while the winner has already saved its output.
    let recorded = generation;
    if (!recorded.result && !revision.provider) {
      try {
        const refreshed = await findGenerationByKey(
          generation.projectId.toString(), generation.ownerId, generation.idempotencyKey,
        );
        if (refreshed?._id.toString() === generation._id.toString()) recorded = refreshed;
      } catch { throw unknownGenerationOutcome(generation._id.toString()); }
    }
    const response = formatCompletedGeneration(recorded, revision);
    await repairPublishedGeneration(recorded, revision);
    return response;
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
    if (generation.errorCode === "REVISION_CONFLICT") {
      throw new AppError(409, "The project changed while this generation was running.", "REVISION_CONFLICT", generation._id.toString());
    }
    throw new AppError(
      409,
      "This generation failed. Send a new Idempotency-Key to retry.",
      "GENERATION_FAILED",
      generation._id.toString(),
    );
  }
  if (generation.result) {
    if (generation.buildPolicyVersion) return queueCandidatePublication(generation, authorization);
    const committed = await publishGeneration(generation);
    return formatCompletedGeneration(generation, committed);
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
  authorization = "",
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
    return replayGeneration(existingGeneration, intent.requestFingerprint, emptyBody, authorization);
  }

  // Parentage and version order differ: an explicitly selected older owned revision is allowed.
  const base = intent.baseRevisionId ? await findProjectRevision(projectId, intent.baseRevisionId) : null;
  if (intent.baseRevisionId && !base) throw new AppError(404, "Revision not found.");
  const head = await findLatestRevision(projectId);
  if (head && !base) {
    // The winner may have finished between our first key lookup and this head read.
    // Recheck before rejecting a retry as a new request against an existing revision.
    const winner = await findGenerationByKey(projectId, ownerId, idempotencyKey);
    if (winner) return replayGeneration(winner, intent.requestFingerprint, emptyBody, authorization);
    throw new AppError(400, "A new generation requires a change prompt and baseRevisionId.", "BASE_REVISION_REQUIRED");
  }
  const expectedVersion = (head?.version ?? 0) + 1;
  if (!Number.isSafeInteger(expectedVersion)) throw new AppError(503, "Project revision version is unavailable.", "OUTCOME_UNKNOWN");
  // Validate the owned context before creating an attempt or spending model tokens.
  const input = {
    projectId, prompt: intent.sourcePrompt,
    ...(base ? { baseRevision: { id: base._id.toString(), version: base.version, files: base.files.map((file) => ({ path: file.path, content: file.content })) } } : {}),
  };
  // Use the real ID's 24-character length so preflight and fetch have identical byte overhead.
  try { prepareGenerationRequest({ ...input, requestId: "000000000000000000000000" }); }
  catch (error) {
    if (error instanceof AppError && error.statusCode === 413) throw error;
    throw new AppError(400, "Selected revision cannot be used as generated frontend context.", "BASE_REVISION_INVALID");
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
      expectedVersion,
      requestPolicyVersion: "generation-request-v1",
      ...(env.BUILD_GATE_ENABLED ? { buildPolicyVersion: "next-static-build-v1" as const } : {}),
    });
  } catch (error) {
    if (!isGenerationKeyDuplicate(error)) throw new AppError(503, "Generation outcome is unknown. Retry with the same key.", "OUTCOME_UNKNOWN");
    const winner = await findGenerationByKey(projectId, ownerId, idempotencyKey);
    if (!winner) throw new AppError(503, "Generation outcome is unknown. Retry with the same key.", "OUTCOME_UNKNOWN");
    return replayGeneration(winner, intent.requestFingerprint, emptyBody, authorization);
  }
  const generationId = generation._id.toString();
  try { await setProjectStatus(projectId, "generating"); }
  catch (error) { logGenerationBookkeepingFailure("generating_hint", generationId, error); }

  const savedResult = await generateFilesForAttempt(generation, { ...input, requestId: generationId });

  // Save paid output separately. An uncertain DB write stays pending, never "AI failed".
  try {
    await saveGenerationResult(generationId, savedResult);
  } catch { throw unknownGenerationOutcome(generationId); }
  generation.result = savedResult;
  if (generation.buildPolicyVersion) return queueCandidatePublication(generation, authorization);
  const revision = await publishGeneration(generation);
  return formatCompletedGeneration(generation, revision);
}

// Only errors at the AI boundary mean generation failed. Persistence has its own recovery path.
async function generateFilesForAttempt(generation: GenerationReadRecord, input: GenerationInput): Promise<GenerationResult> {
  const generationId = generation._id.toString();
  try {
    const aiResult = await requestProjectGeneration(input);
    return {
      provider: aiResult.provider,
      model: aiResult.model,
      summary: aiResult.summary,
      // Persist our independently validated full snapshot, never raw changed-file output.
      files: aiResult.snapshot.files,
      usage: aiResult.usage,
      latencyMs: aiResult.latencyMs,
      fileChanges: aiResult.snapshot.fileChanges,
      // Local validation ran even when the old AI response omitted policy metadata.
      validation: { policyVersion: "frontend-manifest-v1", status: "manifest_validated" },
    };
  } catch (error) {
    const code = error instanceof AppError ? error.code ?? "AI_GENERATION_FAILED" : "AI_GENERATION_FAILED";
    await recordGenerationFailure(generation, code);
    if (error instanceof AppError && error.statusCode === 413) {
      throw new AppError(413, error.message, code, generationId);
    }
    throw new AppError(502, "Code generation failed. Please try again.", code, generationId);
  }
}

// A status read never starts AI or writes publication/bookkeeping; it reports persisted evidence.
export async function getGeneration(ownerId: string, rawProjectId: unknown, rawGenerationId: unknown, query: Record<string, unknown>) {
  const projectId = validateObjectId(rawProjectId, "projectId");
  const generationId = validateObjectId(rawGenerationId, "generationId");
  validateQueryKeys(query, []);
  if (!await findOwnedProject(projectId, ownerId)) throw new AppError(404, "Project not found.");
  const generation = await findOwnedGeneration(projectId, ownerId, generationId);
  if (!generation) throw new AppError(404, "Generation not found.");
  let revision: RevisionReadRecord | null;
  try { revision = await findRevisionForGeneration(projectId, generationId); }
  catch { throw unknownGenerationOutcome(generationId); }
  if (revision) {
    const response = formatCompletedGeneration(generation, revision);
    assertReadResponseSize({ generation: response });
    return response;
  }
  if (generation.status !== "pending" && generation.status !== "failed") throw unknownGenerationOutcome(generationId);
  // Old database error strings must not become an unbounded public response.
  const safeCodes = ["REVISION_CONFLICT", "AI_GENERATION_FAILED", "AI_OUTPUT_INVALID", "CONTEXT_TOO_LARGE", "SNAPSHOT_TOO_LARGE", "BUILD_VERIFICATION_FAILED"];
  const response = {
    id: generationId, status: generation.status, hasSavedResult: !!generation.result,
    errorCode: generation.status === "failed"
      ? (safeCodes.includes(generation.errorCode ?? "") ? generation.errorCode : "GENERATION_FAILED")
      : null,
  };
  assertReadResponseSize({ generation: response });
  return response;
}
