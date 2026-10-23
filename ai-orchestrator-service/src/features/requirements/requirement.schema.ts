import { z } from "zod";

export const REQUIREMENT_POLICY_VERSION = "frontend-requirements-v1";
export const MAX_REQUIREMENT_BYTES = 20_000;

const answerSchema = z.strictObject({
  question: z.string().trim().min(1).max(240),
  answer: z.string().trim().min(1).max(1000),
});

// Compare question identity without making casing or whitespace create another clarification round.
function questionKey(question: string): string {
  return question.trim().replace(/\s+/g, " ").toLowerCase();
}

export const requirementRequestSchema = z.strictObject({
  requestId: z.string().trim().min(1).max(100),
  projectId: z.string().regex(/^[a-f\d]{24}$/i),
  prompt: z.string().trim().min(10).max(1000),
  answers: z.array(answerSchema).max(6).default([]),
}).superRefine((request, context) => {
  // Byte bounds include JSON escaping; silently truncating an answer could change its meaning.
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > MAX_REQUIREMENT_BYTES) {
    context.addIssue({ code: "custom", message: "Requirement context is too large.", params: { code: "CONTEXT_TOO_LARGE" } });
  }
  const questions = request.answers.map((answer) => questionKey(answer.question));
  if (new Set(questions).size !== questions.length) {
    context.addIssue({ code: "custom", path: ["answers"], message: "Supply one current answer per question." });
  }
});

// Keep provider JSON schema straightforward; cross-field rules are checked independently below.
export const requirementAssessmentSchema = z.strictObject({
  status: z.enum(["needs_clarification", "ready", "unsupported"]),
  message: z.string().trim().min(1).max(400).describe("Explain the next step briefly in the user's language."),
  brief: z.string().trim().min(10).max(1000).describe("A reviewable frontend draft using supplied facts and explicit defaults/placeholders. Never invent personal facts."),
  questions: z.array(z.string().trim().min(1).max(240)).max(1)
    .describe("At most one core-purpose question, never optional styling preferences. Empty when ready or unsupported."),
});

// The model must produce a reviewable draft after answers, not start another paid question loop.
const answeredAssessmentSchema = requirementAssessmentSchema.extend({
  status: z.enum(["ready", "unsupported"]),
  questions: requirementAssessmentSchema.shape.questions.max(0).describe("Clarification already answered. Return an empty array."),
});

export type RequirementRequest = z.infer<typeof requirementRequestSchema>;
export type RequirementAssessment = z.infer<typeof requirementAssessmentSchema>;

// Use the same round limit in the provider schema and local validation; never force output to ready.
export function assessmentSchemaFor(request: RequirementRequest): z.ZodType<RequirementAssessment> {
  return request.answers.length > 0 ? answeredAssessmentSchema : requirementAssessmentSchema;
}

// A schema-valid object can still contradict itself or repeat an already answered question.
export function validateRequirementAssessment(input: unknown, request: RequirementRequest): RequirementAssessment {
  const assessment = assessmentSchemaFor(request).parse(input);
  if ((assessment.status === "needs_clarification") !== (assessment.questions.length > 0)) {
    throw new Error("Requirement status and questions disagree.");
  }
  const keys = assessment.questions.map(questionKey);
  const answered = new Set(request.answers.map((answer) => questionKey(answer.question)));
  if (new Set(keys).size !== keys.length || keys.some((key) => answered.has(key))) {
    throw new Error("Requirement questions must be new and distinct.");
  }
  return assessment;
}
