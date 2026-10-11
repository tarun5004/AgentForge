import { createHash } from "node:crypto";
import { z } from "zod";

import { AppError } from "../middlewares/error.middleware.js";

const generationBodySchema = z.strictObject({
  prompt: z.string().trim().min(10).max(1000).optional(),
  baseRevisionId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
});

export type GenerationRequestBody = z.infer<typeof generationBodySchema>;

// Check browser input before any database work. Unknown fields cannot control ownership or files.
export function validateGenerationBody(body: unknown): GenerationRequestBody {
  const parsed = generationBodySchema.safeParse(body === undefined ? {} : body);
  if (!parsed.success) throw new AppError(400, "Invalid generation request body.");
  if (parsed.data.baseRevisionId && parsed.data.prompt === undefined) {
    throw new AppError(400, "prompt is required when baseRevisionId is supplied.");
  }
  return parsed.data;
}

// One key identifies one attempt. Keeping its spelling preserves existing client retries.
export function validateIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(400, "Idempotency-Key header is required.");
  }
  const key = value.trim();
  if (key.length > 100) throw new AppError(400, "Idempotency-Key must be at most 100 characters.");
  return key;
}

// Normalize the actual prompt/base, then hash fixed-order fields so equivalent retries match.
// The hash is an input identifier, not encryption and not a substitute for authentication.
export function createGenerationIntent(
  projectId: string,
  initialPrompt: string,
  body: GenerationRequestBody,
) {
  const sourcePrompt = (body.prompt ?? initialPrompt).trim();
  const baseRevisionId = body.baseRevisionId?.toLowerCase() ?? null;
  const canonicalInput = JSON.stringify({ projectId, prompt: sourcePrompt, baseRevisionId });
  return {
    sourcePrompt,
    baseRevisionId,
    requestFingerprint: createHash("sha256").update(canonicalInput).digest("hex"),
  };
}
