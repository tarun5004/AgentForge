import { env } from "../config/env.js";
import { AppError } from "../middlewares/error.middleware.js";
import { buildVerificationSchema, type BuildVerification } from "./build-verification.js";

// Read only a small result envelope; build logs or oversized internal bodies must not enter memory.
async function readCheckResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Missing check response.");
  let bytes = 0; const chunks: Uint8Array[] = [];
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 16_384) throw new Error("Oversized check response.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// This call outlasts browser deadlines, so it runs ONLY in the bounded in-process worker.
export async function requestCandidateCheck(input: { projectId: string; generationId: string; snapshotHash: string }, authorization: string): Promise<BuildVerification> {
  try {
    if (!env.EXECUTION_CHECK_TOKEN) throw new Error("Check credential unavailable.");
    const response = await fetch(`${env.EXECUTION_SERVICE_URL}/internal/checks`, {
      method: "POST", headers: { "Content-Type": "application/json", authorization, "x-execution-check-token": env.EXECUTION_CHECK_TOKEN },
      body: JSON.stringify(input), redirect: "error", signal: AbortSignal.timeout(180_000),
    });
    const body = await readCheckResponse(response) as { code?: unknown; buildVerification?: unknown };
    if (response.status === 422 && typeof body.code === "string" && ["BUILD_VERIFICATION_FAILED", "CANDIDATE_UNSUPPORTED"].includes(body.code)) {
      throw new AppError(502, "Generated code did not pass the static build check.", "BUILD_VERIFICATION_FAILED", input.generationId);
    }
    if (!response.ok) throw new Error("Check not confirmed.");
    const proof = buildVerificationSchema.parse(body.buildVerification);
    if (proof.snapshotHash !== input.snapshotHash) throw new Error("Candidate hash mismatch.");
    return proof;
  } catch (error) {
    if (error instanceof AppError && error.code === "BUILD_VERIFICATION_FAILED") throw error;
    // An internal 401/timeout is NOT evidence that the browser should be logged out or the code failed.
    throw new AppError(503, "Build check outcome is unconfirmed. Retry the same saved attempt.", "OUTCOME_UNKNOWN", input.generationId);
  }
}
