import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { env } from "../../config/env.js";
import { createAIModel, modelProvider } from "../../config/ai-model.js";
import {
  fileSchema, generationPlanSchema, generationRequestSchema, MANIFEST_POLICY_VERSION,
  MAX_CONTEXT_BYTES, validateFiles, validateGenerationPlan, validateManifest, type GenerationRequest,
} from "./generation.schema.js";
import { GENERATION_INSTRUCTIONS } from "./generation.prompt.js";
import { loadFrontendSkill } from "../../skills/frontend-skill.js";
import { retrieveFrontendGuidance } from "../conversations/frontend-knowledge.js";

// Names are safe diagnostics; raw provider responses and generated source never belong in error logs.
class GenerationError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

// One connected workflow: read fixed guidance locally, plan, then generate complete files before acceptance.
export async function generateProject(input: GenerationRequest, model: LanguageModel = createAIModel(), signal?: AbortSignal) {
  const request = generationRequestSchema.parse(input);
  const startedAt = Date.now();
  const abortSignal = AbortSignal.any([AbortSignal.timeout(80_000), ...(signal ? [signal] : [])]);
  abortSignal.throwIfAborted();
  const skill = await loadFrontendSkill();
  const instructions = `${GENERATION_INSTRUCTIONS}
Reviewed local frontend skill (${skill.id}, ${skill.version}, ${skill.contentSha256}): ${skill.instructions}
Reviewed local references: ${JSON.stringify(retrieveFrontendGuidance(request.prompt).map(({ id, title, text }) => ({ id, title, text })))}`;
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  // All calls share one deadline, no retry, and a bounded escaped context; a failed step ends the request.
  async function generateStep<T>(schema: z.ZodType<T>, data: unknown, maxOutputTokens: number): Promise<T> {
    abortSignal.throwIfAborted();
    const prompt = JSON.stringify(data);
    if (Buffer.byteLength(JSON.stringify({ instructions, prompt }), "utf8") > MAX_CONTEXT_BYTES) {
      throw new GenerationError("GENERATION_CONTEXT_LIMIT", "Generation context exceeds its allowed size.");
    }
    try {
      const result = await generateText({ model, instructions, prompt, output: Output.object({ schema }),
        maxOutputTokens, maxRetries: 0, abortSignal });
      abortSignal.throwIfAborted();
      if (result.finishReason === "length") {
        throw new GenerationError("GENERATION_OUTPUT_LIMIT", "The model reached this step's output limit.");
      }
      if (result.finishReason !== "stop") throw new Error("Generation step did not complete.");
      usage.inputTokens += result.totalUsage.inputTokens ?? 0;
      usage.outputTokens += result.totalUsage.outputTokens ?? 0;
      usage.totalTokens += result.totalUsage.totalTokens ?? 0;
      return result.output;
    } catch (error) {
      // Truncated JSON can fail SDK parsing before a result is available.
      if (NoObjectGeneratedError.isInstance(error) && error.finishReason === "length") {
        throw new GenerationError("GENERATION_OUTPUT_LIMIT", "The model reached this step's output limit.");
      }
      throw error;
    }
  }

  const plan = validateGenerationPlan(await generateStep(generationPlanSchema, {
    task: request.prompt, phase: "plan", baseRevision: request.baseRevision ?? null,
  }, 1000), request.baseRevision?.files);
  const workingFiles = new Map((request.baseRevision?.files ?? []).map(file => [file.path, file]));
  for (const path of plan.deletedPaths) workingFiles.delete(path);
  const files: z.infer<typeof fileSchema>[] = [];
  for (const path of plan.files) {
    // One snapshot replaces previous context: already received files are not duplicated in a tool transcript.
    const file = await generateStep(fileSchema, {
      task: request.prompt, phase: "file", path, plan, workingFiles: [...workingFiles.values()],
    }, 3000);
    if (file.path !== path) throw new Error("Generated file does not match the planned path.");
    // An earlier addition may precede a later shrink; enforce aggregate size on the completed snapshot.
    validateFiles([file]);
    workingFiles.set(path, file);
    files.push(file);
  }
  const manifest = validateManifest({ summary: plan.summary, files, deletedPaths: plan.deletedPaths }, request.baseRevision?.files);
  return {
    requestId: request.requestId, provider: modelProvider, model: env.AI_MODEL, ...manifest,
    // Acceptance proves the manifest policy only; Execution must still compile before publication.
    validation: { policyVersion: MANIFEST_POLICY_VERSION, status: "manifest_validated" as const },
    usage, latencyMs: Date.now() - startedAt,
  };
}
