import { env } from "../config/env.js";
import { validateFileChangeResponse } from "./generation.contract.js";
import { prepareRepairRequest } from "./repair.contract.js";

// One HTTP attempt only; bound response bytes as well as time before parsing model-controlled JSON.
export async function requestProjectRepair(input: Parameters<typeof prepareRepairRequest>[0]) {
  const request = prepareRepairRequest(input);
  const response = await fetch(`${env.AI_ORCHESTRATOR_URL}/internal/repairs`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-internal-service-token": env.INTERNAL_SERVICE_TOKEN,
      "x-request-id": request.requestId },
    body: JSON.stringify(request), redirect: "error", signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("AI repair was not confirmed."); }
  const chunks: Uint8Array[] = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 1_000_000) throw new Error("AI repair response exceeds its byte limit.");
    chunks.push(chunk);
  }
  return validateFileChangeResponse(JSON.parse(Buffer.concat(chunks).toString("utf8")), request.requestId, request.failedFiles);
}
