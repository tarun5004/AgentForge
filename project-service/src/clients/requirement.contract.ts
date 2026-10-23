import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "../middlewares/error.middleware.js";

const answer = z.strictObject({ question: z.string().trim().min(1).max(240), answer: z.string().trim().min(1).max(1000) });
export const briefSubmissionSchema = z.strictObject({
  expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  answers: z.array(answer).max(6).default([]),
});
export type BriefSubmission = z.infer<typeof briefSubmissionSchema>;
export type RequirementRequest = {
  projectId: string;
  prompt: string;
  answers: BriefSubmission["answers"];
  requestId: string;
};

const tokenCount = z.number().int().nonnegative().nullable();
export const assessmentSchema = z.strictObject({
  requestId: z.string().min(1).max(100),
  status: z.enum(["needs_clarification", "ready", "unsupported"]),
  message: z.string().trim().min(1).max(400), brief: z.string().trim().min(10).max(1000),
  questions: z.array(z.string().trim().min(1).max(240)).max(3),
  policyVersion: z.literal("frontend-requirements-v1"), model: z.string().min(1).max(200),
  usage: z.strictObject({ inputTokens: tokenCount, outputTokens: tokenCount, totalTokens: tokenCount }),
  latencyMs: z.number().finite().nonnegative(),
});
export type BriefAssessment = z.infer<typeof assessmentSchema>;

// Canonical identity prevents casing/spacing from creating two answers for the same question.
export function questionIdentity(question: string): string {
  return question.trim().replace(/\s+/g, " ").toLowerCase();
}

// Parse before database/network work; never accept an owner, model, assessment or generated files.
export function parseBriefSubmission(input: unknown): BriefSubmission {
  const result = briefSubmissionSchema.safeParse(input);
  if (!result.success) throw new AppError(400, "Invalid brief submission.", "INVALID_BRIEF");
  const identities = result.data.answers.map((item) => questionIdentity(item.question));
  if (new Set(identities).size !== identities.length) throw new AppError(400, "Supply one answer per question.", "INVALID_BRIEF");
  return result.data;
}

// A full answer snapshot preserves previous facts; sorting makes equivalent transport retries match.
export function briefFingerprint(projectId: string, prompt: string, submission: BriefSubmission): string {
  const answers = submission.answers.map((item) => ({ question: questionIdentity(item.question), answer: item.answer }))
    .sort((left, right) => left.question < right.question ? -1 : left.question > right.question ? 1 : 0);
  return createHash("sha256").update(JSON.stringify({ projectId, prompt, expectedVersion: submission.expectedVersion, answers })).digest("hex");
}

// Match A1's byte/pair limits before reserving a paid attempt; no context is silently truncated.
export function prepareRequirementRequest(projectId: string, prompt: string, submission: BriefSubmission, requestId: string): RequirementRequest {
  // Old records can predate today's schema; reject them before reserving an attempt.
  if (!z.string().trim().min(10).max(1000).safeParse(prompt).success) {
    throw new AppError(400, "Saved project prompt is invalid; create a project with a valid prompt.", "INVALID_BRIEF");
  }
  const request = { projectId, prompt, answers: submission.answers, requestId };
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > 20_000) throw new AppError(413, "Requirement context is too large.", "CONTEXT_TOO_LARGE");
  return request;
}

// Internal credentials do not make arbitrary upstream JSON trustworthy or correctly correlated.
export function validateAssessment(input: unknown, requestId: string, answers: BriefSubmission["answers"]): BriefAssessment {
  const value = assessmentSchema.parse(input);
  const keys = value.questions.map(questionIdentity);
  if (value.requestId !== requestId || (value.status === "needs_clarification") !== (keys.length > 0) ||
      new Set(keys).size !== keys.length || answers.some((item) => keys.includes(questionIdentity(item.question)))) {
    throw new Error("Invalid requirement assessment.");
  }
  return value;
}
