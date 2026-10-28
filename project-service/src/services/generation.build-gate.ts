import { candidateHash, matchingBuildVerification } from "../clients/build-verification.js";
import { BuildVerificationFailure, requestCandidateCheck } from "../clients/execution.client.js";
import { safeRepairDiagnostics } from "../clients/repair.contract.js";
import { AppError } from "../middlewares/error.middleware.js";
import { findOwnedGeneration, saveBuildVerification, type GenerationReadRecord } from "../repositories/generation.repository.js";
import { logGenerationBookkeepingFailure, publishGeneration, recordGenerationFailure, unknownGenerationOutcome } from "./generation.publication.js";

const active = new Map<string, Promise<void>>();
let stopping = false;

// Process-local work only: credentials live in this invocation, never in Mongo/job records.
async function checkAndPublish(generation: GenerationReadRecord, authorization: string): Promise<void> {
  const id = generation._id.toString();
  try {
    if (!generation.result) throw unknownGenerationOutcome(id);
    if (!matchingBuildVerification(generation.buildVerification, generation.result.files)) {
      const proof = await requestCandidateCheck({ projectId: generation.projectId.toString(), generationId: id,
        snapshotHash: candidateHash(generation.result.files) }, authorization);
      await saveBuildVerification(id, proof);
    }
    // Reread persisted evidence: a lost save acknowledgement or another worker cannot bypass the gate.
    const saved = await findOwnedGeneration(generation.projectId.toString(), generation.ownerId, id);
    if (!saved || !saved.result || !matchingBuildVerification(saved.buildVerification, saved.result.files)) throw unknownGenerationOutcome(id);
    await publishGeneration(saved);
  } catch (error) {
    if (error instanceof AppError && error.code === "BUILD_VERIFICATION_FAILED") {
      const diagnostics = error instanceof BuildVerificationFailure
        ? safeRepairDiagnostics(error.diagnostics, generation.result?.files) : [];
      await recordGenerationFailure(generation, "BUILD_VERIFICATION_FAILED", diagnostics);
    } else {
      // Busy, network, DB and expired internal JWT outcomes stay pending for an explicit same-key retry.
      logGenerationBookkeepingFailure("build_gate_unconfirmed", id, error);
    }
  }
}

// Same-process replays join existing work; a fresh authenticated replay can resume after restart.
export function queueCandidatePublication(generation: GenerationReadRecord, authorization: string) {
  const id = generation._id.toString();
  if (stopping || !/^Bearer [A-Za-z0-9._~-]{1,4096}$/.test(authorization)) throw unknownGenerationOutcome(id);
  if (!active.has(id)) {
    if (active.size >= 8) throw unknownGenerationOutcome(id);
    const task = checkAndPublish(generation, authorization).finally(() => { active.delete(id); });
    active.set(id, task);
  }
  return { id, status: "pending" as const, hasSavedResult: true, errorCode: null };
}

// An orderly stop drains bounded checks before disconnecting their publication database.
export async function drainCandidatePublications(): Promise<void> {
  stopping = true;
  await Promise.allSettled([...active.values()]);
}
