import { generateText, gateway, Output } from "ai";

import { env } from "../../config/env.js";
import {
  generatedManifestSchema,
  type GenerationRequest,
  MANIFEST_POLICY_VERSION,
  validateManifest,
} from "./generation.schema.js";
import { buildGenerationPrompt, GENERATION_INSTRUCTIONS } from "./generation.prompt.js";

export async function generateProject(request: GenerationRequest) {
  const startedAt = Date.now();
  const result = await generateText({
    model: gateway(env.AI_MODEL),
    instructions: GENERATION_INSTRUCTIONS,
    prompt: buildGenerationPrompt(request),
    maxOutputTokens: 8_000,
    output: Output.object({ schema: generatedManifestSchema }),
  });

  const manifest = validateManifest(result.output, request.baseRevision?.files);

  return {
    requestId: request.requestId,
    provider: "vercel-ai-gateway" as const,
    model: env.AI_MODEL,
    summary: manifest.summary,
    files: manifest.files,
    deletedPaths: manifest.deletedPaths,
    // This proves manifest checks only, never a build or sandbox execution.
    validation: { policyVersion: MANIFEST_POLICY_VERSION, status: "manifest_validated" as const },
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      totalTokens: result.usage.totalTokens ?? 0,
    },
    latencyMs: Date.now() - startedAt,
  };
}
