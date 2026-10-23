import { env } from "../config/env.js";
import { validateAssessment, type RequirementRequest } from "./requirement.contract.js";

// Exactly one HTTP attempt, no redirects; ambiguous failures must not trigger another model call.
export async function requestAssessment(request: RequirementRequest) {
  const response = await fetch(`${env.AI_ORCHESTRATOR_URL}/internal/requirements`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(50_000),
    headers: { "content-type": "application/json", "x-internal-service-token": env.INTERNAL_SERVICE_TOKEN, "x-request-id": request.requestId },
    body: JSON.stringify(request),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Requirement assessment unavailable.");
  }
  const reader = response.body.getReader();
  let text = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 20_000) throw new Error("Requirement assessment is too large.");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
  const body = JSON.parse(text) as { assessment?: unknown };
  return validateAssessment(body.assessment, request.requestId, request.answers);
}
