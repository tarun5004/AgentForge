import { env } from "../config/env.js";
import {
  prepareGenerationRequest,
  validateGenerationResponse,
  type GenerationInput,
} from "./generation.contract.js";

// Build bounded context first; the HTTP call cannot silently send unsafe or oversized saved files.
export async function requestProjectGeneration(input: GenerationInput) {
  const request = prepareGenerationRequest(input);
  const response = await fetch(`${env.AI_ORCHESTRATOR_URL}/internal/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-service-token": env.INTERNAL_SERVICE_TOKEN,
      "x-request-id": request.requestId,
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    throw new Error(`AI Orchestrator returned status ${response.status}.`);
  }

  return validateGenerationResponse(await response.json(), request);
}
