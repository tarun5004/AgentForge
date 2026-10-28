import { z } from "zod";
import { prepareRepairRequest } from "../clients/repair.contract.js";
import { requestProjectRepair } from "../clients/repair.client.js";
import { env } from "../config/env.js";
import { AppError } from "../middlewares/error.middleware.js";
import type { GenerationResult } from "../models/generation.model.js";
import { findGenerationByKey, findOwnedGeneration, findRepairAttempt, insertPendingGeneration, isGenerationKeyDuplicate,
  isRepairDuplicate, saveGenerationResult, type GenerationReadRecord } from "../repositories/generation.repository.js";
import { findOwnedProject } from "../repositories/project.repository.js";
import { findLatestRevision, findProjectRevision } from "../repositories/revision.repository.js";
import { queueCandidatePublication } from "./generation.build-gate.js";
import { recordGenerationFailure, unknownGenerationOutcome } from "./generation.publication.js";
import { replayGeneration } from "./generation.service.js";
import { validateIdempotencyKey } from "./generation-request.js";
import { validateObjectId } from "./project-read.validation.js";
import { isRepairable, repairFingerprint } from "./repair.policy.js";
import { mergeRevisionFiles } from "./revision-files.js";

// Resolve only the SAME reserved repair; changing a key never buys a second repair of the original.
async function replayRepair(attempt: GenerationReadRecord, originalId: string, key: string, fingerprint: string, authorization: string) {
  if (attempt.repairOf?.toString() !== originalId || attempt.idempotencyKey !== key) {
    throw new AppError(409, "This failed generation already has a reserved repair attempt.", "REPAIR_ALREADY_ATTEMPTED", attempt._id.toString());
  }
  return replayGeneration(attempt, fingerprint, true, authorization);
}

// Reserve once in Mongo -> one model call -> save full candidate -> fresh build gate -> immutable revision.
export async function createRepair(ownerId: string, rawProjectId: unknown, rawGenerationId: unknown,
  header: unknown, body: unknown, authorization: string) {
  const projectId = validateObjectId(rawProjectId, "projectId");
  const originalId = validateObjectId(rawGenerationId, "generationId");
  const key = validateIdempotencyKey(header);
  if (!z.strictObject({}).safeParse(body === undefined ? {} : body).success) throw new AppError(400, "Repair accepts an empty body only.");
  if (!await findOwnedProject(projectId, ownerId)) throw new AppError(404, "Project not found.");
  const original = await findOwnedGeneration(projectId, ownerId, originalId);
  if (!original) throw new AppError(404, "Generation not found.");
  const fingerprint = repairFingerprint(projectId, originalId);
  const existingKey = await findGenerationByKey(projectId, ownerId, key);
  if (existingKey) {
    if (existingKey.repairOf?.toString() !== originalId) throw new AppError(409, "Key already belongs to another request.", "IDEMPOTENCY_MISMATCH");
    return replayRepair(existingKey, originalId, key, fingerprint, authorization);
  }
  const existingRepair = await findRepairAttempt(projectId, ownerId, originalId);
  if (existingRepair) return replayRepair(existingRepair, originalId, key, fingerprint, authorization);
  if (!env.REPAIR_ENABLED) throw new AppError(409, "Explicit build repair is disabled.", "REPAIR_DISABLED");
  if (!isRepairable(original)) throw new AppError(409, "This outcome is not eligible for repair.", "REPAIR_UNAVAILABLE");
  const head = await findLatestRevision(projectId);
  if ((head?.version ?? 0) !== original.expectedVersion! - 1) {
    throw new AppError(409, "The project changed; start a new change from a saved revision.", "REVISION_CONFLICT", originalId);
  }
  const baseId = original.baseRevisionId?.toString() ?? null;
  const base = baseId ? await findProjectRevision(projectId, baseId) : null;
  if (baseId && !base) throw new AppError(409, "The original parent is unavailable.", "REPAIR_UNAVAILABLE");
  const input = prepareRepairRequest({ requestId: "000000000000000000000000", projectId,
    prompt: original.sourcePrompt!, failedFiles: original.result!.files, diagnostics: original.buildDiagnostics! });
  let attempt: GenerationReadRecord;
  try {
    attempt = await insertPendingGeneration({ projectId, ownerId, idempotencyKey: key, repairOf: originalId,
      sourcePrompt: original.sourcePrompt!, baseRevisionId: baseId, requestFingerprint: fingerprint,
      expectedVersion: original.expectedVersion!, requestPolicyVersion: "generation-request-v1", buildPolicyVersion: "next-static-build-v1" });
  } catch (error) {
    if (!isGenerationKeyDuplicate(error) && !isRepairDuplicate(error)) throw new AppError(503, "Repair reservation is unconfirmed. Keep the same key.", "OUTCOME_UNKNOWN");
    const winner = await findGenerationByKey(projectId, ownerId, key) ?? await findRepairAttempt(projectId, ownerId, originalId);
    if (!winner) throw new AppError(503, "Repair reservation is unconfirmed. Keep the same key.", "OUTCOME_UNKNOWN");
    return replayRepair(winner, originalId, key, fingerprint, authorization);
  }
  const id = attempt._id.toString();
  let result: GenerationResult;
  try {
    const repaired = await requestProjectRepair({ ...input, requestId: id });
    // The model edits failed files, but revision ancestry/diff must still refer to the original saved parent.
    const finalPaths = new Set(repaired.snapshot.files.map((file) => file.path));
    const snapshot = mergeRevisionFiles(base?.files ?? [], { files: repaired.snapshot.files,
      deletedPaths: base?.files.filter((file) => !finalPaths.has(file.path)).map((file) => file.path) ?? [] });
    result = { provider: repaired.provider, model: repaired.model, summary: repaired.summary, files: snapshot.files,
      fileChanges: snapshot.fileChanges, usage: repaired.usage, latencyMs: repaired.latencyMs,
      validation: { policyVersion: "frontend-manifest-v1" as const, status: "manifest_validated" as const } };
  } catch {
    // A failed/unknown AI call consumes this repair reservation; it must never silently call the model again.
    await recordGenerationFailure(attempt, "AI_REPAIR_FAILED");
    throw new AppError(502, "The one repair attempt did not produce a valid candidate. Saved revisions are unchanged.", "AI_REPAIR_FAILED", id);
  }
  try { await saveGenerationResult(id, result); }
  catch { throw unknownGenerationOutcome(id); }
  attempt.result = result;
  return queueCandidatePublication(attempt, authorization);
}
