import { z } from "zod";

import { AppError } from "../middlewares/error.middleware.js";
import { mergeRevisionFiles, validateRevisionFiles } from "../services/revision-files.js";

export const MAX_CONTEXT_BYTES = 240_000;

const fileSchema = z.strictObject({
  path: z.string().min(1).max(120),
  content: z.string().min(1).max(30_000),
});
const generationInputSchema = z.strictObject({
  requestId: z.string().trim().min(1).max(100),
  projectId: z.string().regex(/^[a-f\d]{24}$/i),
  prompt: z.string().trim().min(10).max(1000),
  baseRevision: z.strictObject({
    id: z.string().regex(/^[a-f\d]{24}$/i),
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    files: z.array(fileSchema).min(1).max(12),
  }).optional(),
});
export type GenerationInput = z.infer<typeof generationInputSchema>;

const generationResponseSchema = z.strictObject({
  generation: z.strictObject({
    requestId: z.string().min(1).max(100),
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    summary: z.string().min(10).max(240),
    files: z.array(fileSchema).max(12),
    deletedPaths: z.array(z.string().min(1).max(120)).max(12).default([]),
    // Old initial responses omit this; never fabricate proof of validation for them.
    validation: z.strictObject({
      policyVersion: z.literal("frontend-manifest-v1"),
      status: z.literal("manifest_validated"),
    }).optional(),
    usage: z.strictObject({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
    }),
    latencyMs: z.number().int().nonnegative(),
  }),
});

// Validate server-loaded context BEFORE fetch. Never truncate code to fit a size limit.
// This internal helper is not an authorization check; its caller must load the owned base itself.
export function prepareGenerationRequest(input: unknown) {
  const parsed = generationInputSchema.parse(input);
  const request = { ...parsed, template: "nextjs" as const, mode: "economy" as const };
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > MAX_CONTEXT_BYTES) {
    throw new AppError(413, "Serialized generation context is too large.", "CONTEXT_TOO_LARGE");
  }
  if (request.baseRevision) validateRevisionFiles(request.baseRevision.files);
  return request;
}

// Check response identity and independently build the complete snapshot at Project Service.
// Internal HTTP is still a trust boundary; AI metadata does not replace local file validation.
export function validateGenerationResponse(input: unknown, request: GenerationInput) {
  return validateFileChangeResponse(input, request.requestId, request.baseRevision?.files ?? []);
}

// Repairs use the failed snapshot as their edit base; publication still diffs against the original parent.
export function validateFileChangeResponse(input: unknown, requestId: string, baseFiles: { path: string; content: string }[]) {
  try {
    const { generation } = generationResponseSchema.parse(input);
    if (generation.requestId !== requestId) throw new Error("AI response requestId mismatch.");
    const snapshot = mergeRevisionFiles(baseFiles, {
      files: generation.files, deletedPaths: generation.deletedPaths,
    });
    return { ...generation, snapshot };
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 413) throw error;
    throw new AppError(502, "AI Orchestrator returned invalid generation output.", "AI_OUTPUT_INVALID");
  }
}
