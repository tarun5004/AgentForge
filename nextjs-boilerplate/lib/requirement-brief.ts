export type BriefAnswer = { question: string; answer: string };
export type BriefInput = { expectedVersion: number; answers: BriefAnswer[] };
export type RequirementBrief = {
  id: string; version: number; sourcePrompt: string; answers: BriefAnswer[];
  status: "pending" | "completed" | "failed";
  assessment: {
    requestId: string; status: "needs_clarification" | "ready" | "unsupported";
    message: string; brief: string; questions: string[];
    policyVersion: "frontend-requirements-v1"; model: string;
    usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
    latencyMs: number;
  } | null;
  confirmedAt: string | null; errorCode: string | null; createdAt: string;
};
export type PendingBrief = { projectId: string; key: string; body: BriefInput };

// Runtime guards protect the UI from malformed HTTP and stale browser storage.
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
// Match the server's question identity so spacing does not create duplicate answer rows.
function questionKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
// Bounded nonempty text is data, never HTML or a model instruction to execute.
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}
// Nullable usage means unmeasured; do not invent zero-token evidence.
function count(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}
// Answers are cumulative and limited; reject duplicate identities before restoring an intent.
export function isBriefAnswers(value: unknown): value is BriefAnswer[] {
  if (!Array.isArray(value) || value.length > 6 || !value.every((item) => record(item) && text(item.question, 240) && text(item.answer, 1000))) return false;
  return new Set(value.map((item) => questionKey(item.question))).size === value.length;
}
// A ready model response is not consent; enforce state consistency before rendering controls.
export function isRequirementBrief(value: unknown): value is RequirementBrief {
  if (!record(value) || typeof value.id !== "string" || !/^[a-f\d]{24}$/i.test(value.id) ||
      !Number.isSafeInteger(value.version) || Number(value.version) < 1 || !text(value.sourcePrompt, 1000) || value.sourcePrompt.trim().length < 10 ||
      !isBriefAnswers(value.answers) || !["pending", "completed", "failed"].includes(String(value.status)) || typeof value.status !== "string" ||
      typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
      !(value.errorCode === null || text(value.errorCode, 100)) ||
      !(value.confirmedAt === null || (typeof value.confirmedAt === "string" && Number.isFinite(Date.parse(value.confirmedAt))))) return false;
  if (value.status !== "completed") return value.assessment === null && value.confirmedAt === null;
  const assessment = value.assessment;
  if (!record(assessment) || assessment.requestId !== value.id || typeof assessment.status !== "string" ||
      !["needs_clarification", "ready", "unsupported"].includes(assessment.status) || !text(assessment.message, 400) ||
      !text(assessment.brief, 1000) || assessment.brief.trim().length < 10 || !text(assessment.model, 200) ||
      assessment.policyVersion !== "frontend-requirements-v1" || !Array.isArray(assessment.questions) ||
      assessment.questions.length > 3 || !assessment.questions.every((item) => text(item, 240)) ||
      !record(assessment.usage) || ![assessment.usage.inputTokens, assessment.usage.outputTokens, assessment.usage.totalTokens].every(count) ||
      typeof assessment.latencyMs !== "number" || !Number.isFinite(assessment.latencyMs) || assessment.latencyMs < 0) return false;
  const questions = assessment.questions.map(questionKey);
  return (assessment.status === "needs_clarification") === (questions.length > 0) &&
    new Set(questions).size === questions.length && !value.answers.some((item) => questions.includes(questionKey(item.question))) &&
    (value.confirmedAt === null || assessment.status === "ready");
}
// Include previous answers for editing and new questions as blank fields, without dropping context.
export function briefAnswerDrafts(brief: RequirementBrief | null): BriefAnswer[] {
  return [...(brief?.answers.map((item) => ({ ...item })) ?? []),
    ...(brief?.assessment?.questions.map((question) => ({ question, answer: "" })) ?? [])];
}
// Scope intent to account/project; only this tab stores retry identity, never tokens or generated files.
function storageKey(userId: string, projectId: string): string {
  return `agentforge:brief:v1:${userId}:${projectId}`;
}
// Save before POST so a hard refresh can explicitly replay the same logical assessment.
export function savePendingBrief(userId: string, intent: PendingBrief): void {
  try { sessionStorage.setItem(storageKey(userId, intent.projectId), JSON.stringify(intent)); }
  catch { /* Memory still retains the intent when tab storage is unavailable. */ }
}
// Project expected fields only; browser data cannot supply an owner, assessment or model.
export function readPendingBrief(userId: string, projectId: string): PendingBrief | null {
  try {
    const stored = sessionStorage.getItem(storageKey(userId, projectId));
    if (!stored || stored.length > 50_000) return null;
    const value: unknown = JSON.parse(stored);
    if (!record(value) || value.projectId !== projectId || !text(value.key, 100) || !record(value.body) ||
        !Number.isSafeInteger(value.body.expectedVersion) || Number(value.body.expectedVersion) < 0 ||
        Number(value.body.expectedVersion) >= Number.MAX_SAFE_INTEGER || !isBriefAnswers(value.body.answers) ||
        Object.keys(value.body).some((key) => !["expectedVersion", "answers"].includes(key))) return null;
    return { projectId, key: value.key, body: { expectedVersion: Number(value.body.expectedVersion),
      answers: value.body.answers.map((item) => ({ question: item.question, answer: item.answer })) } };
  } catch { return null; }
}
// Clear only a resolved or explicitly abandoned assessment, not another project's intent.
export function clearPendingBrief(userId: string, projectId: string): void {
  try { sessionStorage.removeItem(storageKey(userId, projectId)); }
  catch { /* The server remains the source of saved requirements. */ }
}
