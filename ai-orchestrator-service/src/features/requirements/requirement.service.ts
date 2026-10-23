import { generateText, gateway, Output, type LanguageModel } from "ai";

import { env } from "../../config/env.js";
import { buildRequirementPrompt, REQUIREMENT_INSTRUCTIONS } from "./requirement.prompt.js";
import {
  REQUIREMENT_POLICY_VERSION, assessmentSchemaFor, validateRequirementAssessment,
  type RequirementRequest,
} from "./requirement.schema.js";

// The optional model lets tests exercise the real SDK with its mock provider, never a paid fallback.
export async function assessRequirements(request: RequirementRequest, model: LanguageModel = gateway(env.AI_MODEL)) {
  const startedAt = Date.now();
  const result = await generateText({
    model,
    instructions: REQUIREMENT_INSTRUCTIONS,
    prompt: buildRequirementPrompt(request),
    maxOutputTokens: 1500,
    maxRetries: 0,
    timeout: 45_000,
    output: Output.object({ schema: assessmentSchemaFor(request) }),
  });

  let assessment;
  try {
    assessment = validateRequirementAssessment(result.output, request);
  } catch {
    // Invalid MODEL output is an upstream failure, not a Zod 400 blaming the user's request.
    throw new Error("AI returned an invalid requirement assessment.");
  }
  return {
    requestId: request.requestId,
    ...assessment,
    policyVersion: REQUIREMENT_POLICY_VERSION,
    model: result.response.modelId,
    // Missing provider usage is unknown, not evidence that the request consumed zero tokens.
    usage: {
      inputTokens: result.usage.inputTokens ?? null,
      outputTokens: result.usage.outputTokens ?? null,
      totalTokens: result.usage.totalTokens ?? null,
    },
    latencyMs: Date.now() - startedAt,
  };
}
