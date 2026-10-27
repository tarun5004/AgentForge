import assert from "node:assert/strict";
import { test } from "node:test";
import { createSavedChat, getSavedChat, listSavedChats, savedChatEntries, streamSavedChat } from "./durable-chat.ts";
import { parseWorkspaceSelection, workspaceUrl } from "./workspace-selection.ts";

const id = "100000000000000000000077";
const key = "test-key-123";
const now = new Date().toISOString();
const response = { requestId: `${id}:${key}`, action: "reply", message: "Hello world 😀", prompt: null, sources: [],
  retrieval: { method: "lexical", embeddingModel: null, inputTokens: 0 }, model: "fixture", usage: { inputTokens: null, outputTokens: null, totalTokens: null }, latencyMs: 1 };
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const start = frame("start", { conversationId: id, key });
const complete = frame("complete", { response });

// Every byte is a separate network chunk, including the middle of a multibyte emoji.
function sse(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } }), { headers: { "content-type": "text/event-stream" } });
}

test("SSE decodes split UTF-8 and delivers provisional text before accepting final decision", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => sse(start + frame("message", { message: "Hello 😀" }) + complete);
  const snapshots: string[] = [];
  const result = await streamSavedChat(id, { key, message: "Hi" }, "test-jwt", (text) => snapshots.push(text), AbortSignal.timeout(5000));
  assert.deepEqual(snapshots, ["Hello 😀"]);
  assert.equal(result.message, response.message);
  assert.equal(result.usage.totalTokens, null);
});

test("truncation, forged identity, duplicate completion and error frames never become success", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const text of [start + frame("message", { message: "Partial" }), start + complete + complete,
    frame("start", { conversationId: "forged", key }) + complete, start + frame("error", { message: "private" }),
    start + frame("complete", { response: { ...response, action: "build" } }), start + frame("message", { message: "x".repeat(32_001) })]) {
    globalThis.fetch = async () => sse(text);
    await assert.rejects(streamSavedChat(id, { key, message: "Hi" }, "test-jwt", () => {}, AbortSignal.timeout(5000)));
  }
});

test("interrupted stream makes one request, never an automatic paid retry", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return sse(start); };
  await assert.rejects(streamSavedChat(id, { key, message: "Hi" }, "test-jwt", () => {}, AbortSignal.timeout(5000)));
  assert.equal(calls, 1);
});

test("server history validates identity and restores completed/interrupted turns without starting work", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const chat = { id, title: "A saved chat", projectId: null, createdAt: now, updatedAt: now, turnCount: 2, nextBefore: null,
    turns: [{ key, message: "Hi", status: "complete", response, createdAt: now }, { key: "pending-key", message: "Next", status: "interrupted", response: null, createdAt: now }] };
  globalThis.fetch = async () => Response.json({ conversation: chat });
  const saved = await getSavedChat(id, "test-jwt");
  const entries = savedChatEntries(saved);
  assert.equal(entries.length, 4);
  assert.equal(entries[1]?.text, response.message);
  assert.equal(entries.at(-1)?.state, "unknown");
  globalThis.fetch = async () => Response.json({ conversation: { ...chat, id: "forged" } });
  await assert.rejects(getSavedChat(id, "test-jwt"));
});

test("conversation list/create use authenticated fixed routes without sending owner identity", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const summary = { id, title: "Saved", projectId: null, createdAt: now, updatedAt: now };
  const requests: { path: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => { requests.push({ path: String(input), init }); return Response.json(init?.method === "POST" ? { conversation: summary } : { conversations: [summary], nextCursor: null }); };
  assert.equal((await createSavedChat("test-jwt")).id, id);
  assert.equal((await listSavedChats("test-jwt")).conversations[0]?.id, id);
  assert.equal(requests[0]?.init?.body, "{}");
  assert.equal(new Headers(requests[0]?.init?.headers).get("authorization"), "Bearer test-jwt");
  assert.equal(requests[1]?.init?.method, "GET");
});

test("workspace links preserve conversation selection without breaking legacy project URLs", () => {
  assert.equal(workspaceUrl(null, null, id), `/workspace?conversation=${id}`);
  assert.equal(parseWorkspaceSelection({ conversation: id }).conversationId, id);
  assert.ok(parseWorkspaceSelection({ conversation: [id, id] }).error);
  assert.ok(parseWorkspaceSelection({ conversation: "javascript:bad" }).error);
});
