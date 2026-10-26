import assert from "node:assert/strict";
import { test } from "node:test";
import { clearConversation, generationActivity, isChatEntry, readConversation, restoreRevisionMessages,
  saveConversation, upsertChatEntry, type ChatEntry, type Conversation } from "./conversation.ts";
import type { Project, RevisionSummary } from "./project-api.ts";

const date = "2026-10-25T10:00:00.000Z";
const empty: Conversation = { entries: [], trimmed: false, warning: "" };
const message: ChatEntry = { id: "attempt-1", role: "assistant", kind: "activity", text: "Generation requested.", createdAt: date, state: "working" };

// Fake storage exercises persistence in Node without a browser, database or provider call.
function memoryStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  return values;
}

test("same attempt updates in place without losing its original ordering or mutating input", () => {
  const first = upsertChatEntry(empty, message);
  const done = upsertChatEntry(first, { ...message, text: "Output saved.", createdAt: "2026-10-25T10:01:00.000Z", state: "done" });
  assert.equal(done.entries.length, 1);
  assert.equal(done.entries[0]?.createdAt, date);
  assert.equal(done.entries[0]?.state, "done");
  assert.equal(first.entries[0]?.state, "working");
  assert.deepEqual(empty.entries, []);
});

test("bounded history visibly marks trimming and rejects malformed or executable metadata", () => {
  let result = empty;
  for (let i = 0; i < 130; i++) result = upsertChatEntry(result, { ...message, id: `attempt-${i}` });
  assert.equal(result.entries.length, 120);
  assert.equal(result.trimmed, true);
  for (const invalid of [{ ...message, role: ["user"] }, { ...message, state: ["done"] },
    { ...message, createdAt: "tomorrow" }, { ...message, token: "must-not-store" },
    { ...message, text: "x".repeat(2001) }, { ...message, details: Array(41).fill("extra") }]) assert.equal(isChatEntry(invalid), false);
});

test("history is account/project scoped and a refreshed running step is unconfirmed, not retried", () => {
  memoryStorage();
  assert.equal(saveConversation("owner-a", "project-a", upsertChatEntry(empty, message)), true);
  assert.equal(readConversation("owner-a", "project-a").entries[0]?.state, "unknown");
  assert.equal(readConversation("owner-b", "project-a").entries.length, 0);
  assert.equal(readConversation("owner-a", "project-b").entries.length, 0);
});

test("corrupt, oversized and unavailable storage degrade without breaking saved revisions", context => {
  const values = memoryStorage();
  saveConversation("owner", "project", empty);
  const key = [...values.keys()][0]!;
  for (const value of ["{bad", "x".repeat(800001), JSON.stringify({ version: 99, entries: [] }),
    JSON.stringify({ version: 1, entries: [message, message], trimmed: false })]) {
    values.set(key, value);
    assert.ok(readConversation("owner", "project").warning);
  }
  context.mock.method(localStorage, "getItem", () => { throw new Error("Disabled"); });
  context.mock.method(localStorage, "setItem", () => { throw new Error("Full"); });
  assert.ok(readConversation("owner", "project").warning);
  assert.equal(saveConversation("owner", "project", empty), false);
});

test("server revision reconstruction restores chronology and never invents a tool/build pass", () => {
  const project = { id: "100000000000000000000001", initialPrompt: "Build a frontend portfolio", createdAt: date } as Project;
  const revision = { id: "200000000000000000000001", version: 1, summary: "Portfolio saved", createdAt: "2026-10-25T10:01:00.000Z" } as RevisionSummary;
  const result = restoreRevisionMessages(project, [revision], empty);
  assert.equal(result.entries[0]?.role, "user");
  assert.equal(result.entries[1]?.kind, "result");
  assert.equal(result.entries[1]?.revisionId, revision.id);
  assert.equal(restoreRevisionMessages(project, [revision], result).entries.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /build passed|Tool completed/);
});

test("clear affects only the chosen display cache and reconstruction preserves original dates", () => {
  memoryStorage();
  saveConversation("owner-a", "project-a", upsertChatEntry(empty, message));
  saveConversation("owner-b", "project-a", upsertChatEntry(empty, message));
  clearConversation("owner-a", "project-a");
  assert.equal(readConversation("owner-a", "project-a").entries.length, 0);
  assert.equal(readConversation("owner-b", "project-a").entries.length, 1);
  const later = upsertChatEntry(empty, { ...message, createdAt: "2026-10-25T11:00:00.000Z" });
  const chronological = upsertChatEntry(later, { ...message, id: "saved-brief", createdAt: date });
  assert.equal(chronological.entries[0]?.id, "saved-brief");
});

test("UTF-8 history is bounded without shortening an individual user's message or file list", () => {
  let conversation = empty;
  const details = Array(40).fill("界".repeat(1000));
  for (let i = 0; i < 5; i++) conversation = upsertChatEntry(conversation, { ...message, id: `large-${i}`, details });
  assert.ok(new TextEncoder().encode(JSON.stringify(conversation.entries)).length <= 400_000);
  assert.equal(conversation.trimmed, true);
  assert.deepEqual(conversation.entries.at(-1)?.details, details);
});

test("progress distinguishes saved output from a build pass and never invents tool events", () => {
  const pending = { id: "300000000000000000000001", status: "pending" as const, hasSavedResult: false, errorCode: null };
  assert.deepEqual(generationActivity(pending), []);
  assert.deepEqual(generationActivity({ ...pending, hasSavedResult: true }), ["Generated output saved by Project Service."]);
  assert.doesNotMatch(generationActivity({ ...pending, status: "failed", errorCode: "BUILD_VERIFICATION_FAILED" }).join(" "), /build passed|published/);
});
