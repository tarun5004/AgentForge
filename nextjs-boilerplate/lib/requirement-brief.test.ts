import assert from "node:assert/strict";
import { test } from "node:test";
import { assessRequirementBrief, generateConfirmedBrief, getRequirementBrief, updateRequirementBrief, ProjectApiError } from "./project-api.ts";
import { briefAnswerDrafts, isRequirementBrief, readPendingBrief, savePendingBrief, clearPendingBrief } from "./requirement-brief.ts";
import { readPendingGeneration, savePendingGeneration } from "./pending-generation.ts";

const projectId = "100000000000000000000001";
const id = "200000000000000000000001";
const brief = {
  id, version: 1, sourcePrompt: "Build my portfolio website", answers: [], status: "completed",
  assessment: { requestId: id, status: "ready", message: "Review these requirements.", brief: "Build a portfolio for Ada, a developer.",
    questions: [], policyVersion: "frontend-requirements-v1", model: "test-fixture",
    usage: { inputTokens: null, outputTokens: null, totalTokens: null }, latencyMs: 0 },
  confirmedAt: null, errorCode: null, createdAt: "2026-10-23T00:00:00.000Z",
};

test("brief guard separates ready, consent and pending, rejecting malformed metadata", () => {
  assert.equal(isRequirementBrief(brief), true);
  for (const value of [{ ...brief, status: ["completed"] }, { ...brief, version: 0 }, { ...brief, sourcePrompt: "short" },
    { ...brief, assessment: { ...brief.assessment, requestId: projectId } },
    { ...brief, assessment: { ...brief.assessment, status: "needs_clarification" } },
    { ...brief, confirmedAt: "invalid-date" }, { ...brief, status: "pending", confirmedAt: brief.createdAt },
    { ...brief, assessment: { ...brief.assessment, usage: { ...brief.assessment.usage, totalTokens: -1 } } }]) {
    assert.equal(isRequirementBrief(value), false);
  }
  assert.equal(isRequirementBrief({ ...brief, status: "pending", assessment: null }), true);
});

test("read is abortable and accepts null for untouched projects without automatic mutation", async (context) => {
  const controller = new AbortController();
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, `/api/projects/${projectId}/brief`);
    assert.equal(init.signal, controller.signal);
    assert.equal(init.method, undefined);
    return Response.json({ brief: null });
  });
  assert.equal(await getRequirementBrief(projectId, "token", controller.signal), null);
});

test("assessment replay sends exact key/body; ready response does not trigger code generation", async (context) => {
  const calls: RequestInit[] = [];
  context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    calls.push(init); return Response.json({ brief });
  });
  const input = { expectedVersion: 0, answers: [] };
  for (let i = 0; i < 2; i++) await assessRequirementBrief(projectId, "token", "same-key", input);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(new Headers(call.headers).get("Idempotency-Key"), "same-key");
    assert.deepEqual(JSON.parse(String(call.body)), input);
  }
});

test("actions send no editable brief; generation has its own stable key and only IDs", async (context) => {
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(init.body, "{}");
    if (url.endsWith("/confirm")) return Response.json({ brief: { ...brief, confirmedAt: brief.createdAt } });
    assert.equal(url, `/api/projects/${projectId}/brief/${id}/generations`);
    assert.equal(new Headers(init.headers).get("Idempotency-Key"), "generation-key");
    return Response.json({ generation: { id, status: "pending", hasSavedResult: true, errorCode: null } }, { status: 202 });
  });
  assert.equal((await updateRequirementBrief(projectId, id, "confirm", "token")).confirmedAt, brief.createdAt);
  assert.equal((await generateConfirmedBrief(projectId, id, "token", "generation-key")).status, "pending");
});

test("errors preserve uncertainty codes without silently issuing another POST", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ message: "Outcome unknown", code: "OUTCOME_UNKNOWN" }, { status: 503 }); });
  await assert.rejects(assessRequirementBrief(projectId, "token", "key", { expectedVersion: 0, answers: [] }),
    (error: unknown) => error instanceof ProjectApiError && error.status === 503 && error.code === "OUTCOME_UNKNOWN");
  assert.equal(calls, 1);
});

test("answer drafts preserve old facts and new questions without mutating server data", () => {
  assert.ok(isRequirementBrief(brief));
  const saved = { ...brief, answers: [{ question: "Name?", answer: "Ada" }], assessment: { ...brief.assessment, status: "needs_clarification" as const, questions: ["Role?"] } };
  const drafts = briefAnswerDrafts(saved);
  assert.deepEqual(drafts, [{ question: "Name?", answer: "Ada" }, { question: "Role?", answer: "" }]);
  drafts[0]!.answer = "Bob";
  assert.equal(saved.answers[0]!.answer, "Ada");
});

test("scoped browser intent round-trips identity, rejects overrides and retains confirmed-generation route", (context) => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { value: {
    setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
  }, configurable: true });
  context.after(() => Reflect.deleteProperty(globalThis, "sessionStorage"));
  const intent = { projectId, key: "brief-key", body: { expectedVersion: 1, answers: [{ question: "Name?", answer: "Ada" }] } };
  savePendingBrief("owner", intent);
  assert.deepEqual(readPendingBrief("owner", projectId), intent);
  assert.equal(readPendingBrief("other-owner", projectId), null);
  const storageKey = [...values.keys()][0]!;
  values.set(storageKey, JSON.stringify({ ...intent, body: { ...intent.body, ownerId: "forged" } }));
  assert.equal(readPendingBrief("owner", projectId), null);
  clearPendingBrief("owner", projectId);
  assert.equal(readPendingBrief("owner", projectId), null);
  const generationIntent = { projectId, key: "gen-key", body: {}, briefId: id };
  savePendingGeneration("owner", generationIntent);
  assert.deepEqual(readPendingGeneration("owner", projectId), generationIntent);
});
