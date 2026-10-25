import { gateway, isStepCount, Output, tool, ToolLoopAgent, type LanguageModel } from "ai";
import { z } from "zod";

import { env } from "../../config/env.js";
import {
  generatedManifestSchema,
  type GenerationRequest,
  MANIFEST_POLICY_VERSION,
  validateManifest,
} from "./generation.schema.js";
import { buildGenerationPrompt, GENERATION_INSTRUCTIONS } from "./generation.prompt.js";
import { FRONTEND_SKILL_ID, loadFrontendSkill } from "../../skills/frontend-skill.js";

// One read-only skill call precedes generation; tests inject an SDK mock, never a production fake mode.
export async function generateProject(request: GenerationRequest, model: LanguageModel = gateway(env.AI_MODEL)) {
  const startedAt = Date.now();
  // Missing/changed local guidance fails before spending on a model request.
  const skill = await loadFrontendSkill();
  let skillLoaded = false;
  const agent = new ToolLoopAgent({
    model,
    instructions: GENERATION_INSTRUCTIONS,
    maxOutputTokens: 8_000,
    maxRetries: 0,
    stopWhen: isStepCount(2),
    tools: {
      loadSkill: tool({
        description: "Read the reviewed frontend-design skill before generating frontend files. No files are executed or changed.",
        inputSchema: z.strictObject({ skillId: z.literal(FRONTEND_SKILL_ID) }),
        // Budget lives inside this request; another generation gets its own single read.
        execute: async () => {
          if (skillLoaded) throw new Error("Frontend skill may be loaded only once per generation.");
          skillLoaded = true;
          process.stdout.write(`${JSON.stringify({
            level: "info", service: "ai-orchestrator-service", event: "skill_loaded",
            skillId: skill.id, skillVersion: skill.version, contentSha256: skill.contentSha256,
          })}\n`);
          return skill;
        },
      }),
    },
    // Require one real tool result, then disable tools for the final structured answer.
    prepareStep: ({ stepNumber, steps, messages }) => {
      if (stepNumber === 0) {
        return { toolChoice: { type: "tool", toolName: "loadSkill" }, maxOutputTokens: 256 };
      }
      if (stepNumber !== 1 || !skillLoaded || steps[0]?.toolCalls.length !== 1 || steps[0]?.toolResults.length !== 1) {
        throw new Error("Generation requires exactly one successful frontend skill read.");
      }
      // Base files are needed for editing, not for selecting the only frontend skill.
      const finalMessages = [...messages];
      if (request.baseRevision) finalMessages.push({ role: "user", content: buildGenerationPrompt(request) });
      return { toolChoice: "none", activeTools: [], messages: finalMessages };
    },
    output: Output.object({ schema: generatedManifestSchema }),
  });
  const result = await agent.generate({ prompt: request.prompt, timeout: 80_000 });
  if (!skillLoaded || result.steps.length !== 2 || result.steps[1]?.toolCalls.length !== 0) {
    throw new Error("Generation did not follow the bounded skill workflow.");
  }

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
      // Sum both model steps; reporting only the final generation would hide the skill-selection cost.
      inputTokens: result.totalUsage.inputTokens ?? 0,
      outputTokens: result.totalUsage.outputTokens ?? 0,
      totalTokens: result.totalUsage.totalTokens ?? 0,
    },
    latencyMs: Date.now() - startedAt,
  };
}
