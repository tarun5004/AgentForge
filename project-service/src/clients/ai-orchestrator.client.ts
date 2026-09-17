import { z } from "zod";

import { env } from "../config/env.js";

const generationResponseSchema = z.object({
  generation: z.object({
    requestId: z.string(),
    provider: z.string(),
    model: z.string(),
    summary: z.string(),
    files: z.array(z.object({ path: z.string(), content: z.string() })).min(1),
    usage: z.object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
    }),
    latencyMs: z.number().int().nonnegative(),
  }),
});

export async function requestProjectGeneration(input: {
  requestId: string;
  projectId: string;
  prompt: string;
}) {
  const response = await fetch(`${env.AI_ORCHESTRATOR_URL}/internal/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-service-token": env.INTERNAL_SERVICE_TOKEN,
      "x-request-id": input.requestId,
    },
    body: JSON.stringify({
      ...input,
      template: "nextjs",
      mode: "economy",
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    throw new Error(`AI Orchestrator returned status ${response.status}.`);
  }

  return generationResponseSchema.parse(await response.json()).generation;
}
