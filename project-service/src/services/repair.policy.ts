import { createHash } from "node:crypto";
import { safeRepairDiagnostics } from "../clients/repair.contract.js";
import type { GenerationReadRecord } from "../repositories/generation.repository.js";

// Only a known compiler failure with captured intent is repairable, never an uncertain/infrastructure outcome.
export function isRepairable(generation: GenerationReadRecord): boolean {
  return generation.status === "failed" && generation.errorCode === "BUILD_VERIFICATION_FAILED" &&
    generation.buildPolicyVersion === "next-static-build-v1" && !generation.buildVerification && !generation.repairOf &&
    generation.requestPolicyVersion === "generation-request-v1" && !!generation.sourcePrompt && !!generation.requestFingerprint &&
    Number.isSafeInteger(generation.expectedVersion) && (generation.expectedVersion ?? 0) > 0 &&
    !!generation.result && safeRepairDiagnostics(generation.buildDiagnostics, generation.result.files).length > 0;
}

// Domain separation prevents an ordinary generation key from replaying a different repair operation.
export function repairFingerprint(projectId: string, generationId: string): string {
  return createHash("sha256").update(JSON.stringify({ operation: "repair-v1", projectId, generationId })).digest("hex");
}
