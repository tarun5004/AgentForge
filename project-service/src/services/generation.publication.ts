import { prepareGenerationRequest, validateGenerationResponse } from "../clients/generation.contract.js";
import { AppError } from "../middlewares/error.middleware.js";
import { matchingBuildVerification } from "../clients/build-verification.js";
import type { RepairDiagnostic } from "../clients/repair.contract.js";
import {
  markGenerationFailed,
  markGenerationReady,
  type GenerationReadRecord,
} from "../repositories/generation.repository.js";
import { markProjectRevisionPublished, setProjectStatus } from "../repositories/project.repository.js";
import {
  findLatestRevision,
  findProjectRevision,
  findRevisionForGeneration,
  insertRevision,
  isRevisionVersionDuplicate,
  type NewRevision,
  type RevisionReadRecord,
  type RevisionSummaryRecord,
} from "../repositories/revision.repository.js";

// A DB timeout is not proof of failure. Keep the key so a later read/replay can reconcile it.
export function unknownGenerationOutcome(generationId: string): AppError {
  return new AppError(503, "Generation outcome is unknown. Retry with the same key.", "OUTCOME_UNKNOWN", generationId);
}

// Log only safe identifiers, never provider messages, prompts, file contents or credentials.
export function logGenerationBookkeepingFailure(step: string, generationId: string, error: unknown): void {
  process.stderr.write(`${JSON.stringify({
    level: "warn", service: "project-service", message: "generation_bookkeeping_failed",
    step, generationId, errorName: error instanceof Error ? error.name : "UnknownError",
  })}\n`);
}

// Cache failures cannot undo a committed Revision. POST replay can repair these hints later.
export async function repairPublishedGeneration(generation: GenerationReadRecord, revision: RevisionReadRecord): Promise<void> {
  const id = generation._id.toString();
  try {
    await markGenerationReady(id, revision._id.toString());
  } catch (error) {
    logGenerationBookkeepingFailure("mark_ready", id, error);
  }
  try {
    await markProjectRevisionPublished(generation.projectId.toString(), revision.version);
  } catch (error) {
    logGenerationBookkeepingFailure("project_hint", id, error);
  }
}

// A failed attempt does not make an older saved revision disappear or reserve a new version.
export async function recordGenerationFailure(generation: GenerationReadRecord, code: string, diagnostics?: RepairDiagnostic[]): Promise<void> {
  const id = generation._id.toString();
  try { await markGenerationFailed(id, code, diagnostics); }
  catch (error) { logGenerationBookkeepingFailure("mark_failed", id, error); }
  try {
    const projectId = generation.projectId.toString();
    const head = await findLatestRevision(projectId);
    if (head) await markProjectRevisionPublished(projectId, head.version);
    else await setProjectStatus(projectId, "failed");
  } catch (error) { logGenerationBookkeepingFailure("restore_project_hint", id, error); }
}

// Reconstruct publication solely from stored intent/result; this function never calls AI.
// Revalidate the snapshot and compute its diff against the ORIGINAL parent, not today's head.
async function prepareSavedRevision(generation: GenerationReadRecord): Promise<NewRevision> {
  const id = generation._id.toString();
  const expectedVersion = generation.expectedVersion;
  if (!generation.result || !generation.sourcePrompt || !generation.requestFingerprint ||
    typeof expectedVersion !== "number" || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 ||
    generation.requestPolicyVersion !== "generation-request-v1") {
    throw unknownGenerationOutcome(id); // Legacy records without captured intent cannot be guessed.
  }
  const baseId = generation.baseRevisionId?.toString() ?? null;
  const base = baseId ? await findProjectRevision(generation.projectId.toString(), baseId) : null;
  if (baseId && !base) throw unknownGenerationOutcome(id);
  if ((!baseId && expectedVersion !== 1) || (base && base.version >= expectedVersion)) {
    throw unknownGenerationOutcome(id);
  }
  const request = prepareGenerationRequest({
    requestId: id, projectId: generation.projectId.toString(), prompt: generation.sourcePrompt,
    ...(base ? { baseRevision: { id: base._id.toString(), version: base.version, files: base.files } } : {}),
  });
  const result = generation.result;
  const finalPaths = new Set(result.files.map((file) => file.path));
  // Saved result is already a FULL snapshot: derive removed paths only for recovery revalidation.
  const deletedPaths = base?.files.filter((file) => !finalPaths.has(file.path)).map((file) => file.path) ?? [];
  const checked = validateGenerationResponse({ generation: {
    requestId: id, provider: result.provider, model: result.model, summary: result.summary,
    files: result.files, deletedPaths, usage: result.usage, latencyMs: result.latencyMs,
    ...(result.validation ? { validation: result.validation } : {}),
  } }, request);
  if (result.fileChanges && JSON.stringify(result.fileChanges) !== JSON.stringify(checked.snapshot.fileChanges)) {
    throw unknownGenerationOutcome(id);
  }
  // Enforce captured policy here as well as in the worker: every replay/publication path hits this guard.
  const buildVerification = matchingBuildVerification(generation.buildVerification, checked.snapshot.files);
  if (generation.buildPolicyVersion && (generation.buildPolicyVersion !== "next-static-build-v1" || !buildVerification)) {
    throw unknownGenerationOutcome(id);
  }
  return {
    projectId: generation.projectId.toString(), generationId: id,
    version: expectedVersion, parentRevisionId: baseId, sourcePrompt: generation.sourcePrompt,
    summary: checked.summary, files: checked.snapshot.files, fileChanges: checked.snapshot.fileChanges,
    provider: checked.provider, model: checked.model, usage: checked.usage, latencyMs: checked.latencyMs,
    validation: { policyVersion: "frontend-manifest-v1" as const, status: "manifest_validated" as const },
    schemaVersion: 2 as const,
    ...(generation.buildPolicyVersion && buildVerification ? { buildVerification } : {}),
  };
}

// A concurrent replay may have committed THIS attempt already. Prove that before declaring a loser.
async function resolveRevisionConflict(generation: GenerationReadRecord, latestId?: string): Promise<RevisionReadRecord> {
  const id = generation._id.toString();
  let committed: RevisionReadRecord | null;
  try { committed = await findRevisionForGeneration(generation.projectId.toString(), id); }
  catch { throw unknownGenerationOutcome(id); }
  if (committed) {
    await repairPublishedGeneration(generation, committed);
    return committed;
  }
  await recordGenerationFailure(generation, "REVISION_CONFLICT");
  throw new AppError(409, "The project changed while this generation was running.", "REVISION_CONFLICT", id, latestId);
}

// One immutable Revision insert is the commit point. Unique version/generation indexes arbitrate races.
// Callers must have proved ownership before supplying the stored Generation.
export async function publishGeneration(generation: GenerationReadRecord): Promise<RevisionReadRecord> {
  const id = generation._id.toString();
  let input: NewRevision;
  try {
    const committed = await findRevisionForGeneration(generation.projectId.toString(), id);
    if (committed) {
      await repairPublishedGeneration(generation, committed);
      return committed;
    }
    input = await prepareSavedRevision(generation);
  } catch { throw unknownGenerationOutcome(id); }

  // Check again after model latency/recovery. The unique index closes the remaining insert race.
  // Also detect a changed head whose old version allocation did not use our next-version rule.
  let head: RevisionSummaryRecord | null;
  try { head = await findLatestRevision(input.projectId); }
  catch { throw unknownGenerationOutcome(id); }
  if ((head?.version ?? 0) !== input.version - 1) {
    return resolveRevisionConflict(generation, head?._id.toString());
  }

  let revision: RevisionReadRecord;
  try {
    revision = await insertRevision(input);
  } catch (error) {
    // The insert might have succeeded but its acknowledgement was lost. Check before classifying it.
    let committed: RevisionReadRecord | null;
    try { committed = await findRevisionForGeneration(input.projectId, id); }
    catch { throw unknownGenerationOutcome(id); }
    if (committed) {
      await repairPublishedGeneration(generation, committed);
      return committed;
    }
    if (isRevisionVersionDuplicate(error)) {
      let latestId: string | undefined;
      try { latestId = (await findLatestRevision(input.projectId))?._id.toString(); }
      catch (readError) { logGenerationBookkeepingFailure("conflict_head", id, readError); }
      return resolveRevisionConflict(generation, latestId);
    }
    // Preserve pending + saved result so replay can retry publication without another model call.
    throw unknownGenerationOutcome(id);
  }
  await repairPublishedGeneration(generation, revision);
  return revision;
}
