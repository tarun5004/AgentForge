import { generateText, gateway, Output } from "ai";

import { env } from "../../config/env.js";
import {
  generatedManifestSchema,
  type GenerationRequest,
  validateManifest,
} from "./generation.schema.js";

const SYSTEM_INSTRUCTIONS = `You generate a small frontend-only Next.js App Router page.
Return only the files needed to satisfy the user's request.
Use TypeScript, React, accessible HTML, responsive CSS, and simple readable components.
Use only React, Next.js, and plain CSS; do not add npm dependencies.
Allowed folders are app, components, and lib.
Never create API routes, server actions, middleware, environment files, secrets, or backend code.
Keep the result compact: prefer 3-6 files and avoid repeated code.`;

export async function generateProject(request: GenerationRequest) {
  const startedAt = Date.now();
  const result = await generateText({
    model: gateway(env.AI_MODEL),
    instructions: SYSTEM_INSTRUCTIONS,
    prompt: request.prompt,
    maxOutputTokens: 8_000,
    output: Output.object({ schema: generatedManifestSchema }),
  });

  const manifest = validateManifest(result.output);

  return {
    requestId: request.requestId,
    provider: "vercel-ai-gateway" as const,
    model: env.AI_MODEL,
    summary: manifest.summary,
    files: manifest.files,
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      totalTokens: result.usage.totalTokens ?? 0,
    },
    latencyMs: Date.now() - startedAt,
  };
}
