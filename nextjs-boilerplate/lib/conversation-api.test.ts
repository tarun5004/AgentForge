import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { conversationContext, conversationReport, isConversationResponse, sendConversation } from "./conversation-api.ts";
import type { ChatEntry } from "./conversation.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const response = {
  requestId: "test-response", action: "reply" as const, message: "Hi! What would you like to work on?", prompt: null,
  sources: [], retrieval: { method: "lexical" as const, embeddingModel: null, inputTokens: 0 },
  model: "test-model", usage: { inputTokens: null, outputTokens: null, totalTokens: null }, latencyMs: 10,
};

test("a short greeting uses conversation without creating a project or sending browser files", async () => {
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(input, "/api/conversations");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-only");
    assert.deepEqual(JSON.parse(String(init?.body)), { messages: [{ role: "user", content: "Hi" }] });
    return Response.json({ response });
  };
  assert.deepEqual(await sendConversation({ messages: [{ role: "user", content: "Hi" }] }, "test-only"), response);
  assert.equal(calls, 1);
});

test("only a consistent validated build decision may enter generation", () => {
  assert.equal(isConversationResponse(response), true);
  assert.equal(isConversationResponse({ ...response, action: "build" }), false);
  assert.equal(isConversationResponse({ ...response, action: "reply", prompt: "Build a portfolio" }), false);
  assert.equal(isConversationResponse({ ...response, usage: { totalTokens: -1 } }), false);
  assert.equal(isConversationResponse({ ...response, retrieval: { method: "invented" } }), false);
  assert.equal(isConversationResponse({ ...response, action: "build", prompt: "Build a responsive portfolio." }), true);
});

test("upstream 502 and malformed success are never automatically retried", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ message: "AI unavailable", code: "AI_UNAVAILABLE" }, { status: 502 }); };
  await assert.rejects(sendConversation({ messages: [{ role: "user", content: "Hi" }] }, "test-only"), /AI unavailable/);
  assert.equal(calls, 1);
  globalThis.fetch = async () => Response.json({ response: { ...response, action: "build" } });
  await assert.rejects(sendConversation({ messages: [{ role: "user", content: "Hi" }] }, "test-only"), /invalid reply/);
});

test("context excludes activity, keeps recent replies, and visibly reports the bounded window", () => {
  const entries: ChatEntry[] = Array.from({ length: 20 }, (_, index) => ({
    id: String(index), role: index % 2 ? "assistant" : "user", kind: "message", text: `Message ${index}`, createdAt: new Date().toISOString(),
  }));
  entries.push({ ...entries[0], id: "activity", kind: "activity", text: "internal progress, not conversation" });
  const context = conversationContext(entries, "Build it now");
  assert.equal(context.messages.length, 16);
  assert.equal(context.trimmed, true);
  assert.deepEqual(context.messages.at(-1), { role: "user", content: "Build it now" });
  assert.equal(JSON.stringify(context.messages).includes("internal progress"), false);
  assert.ok(new TextEncoder().encode(JSON.stringify(conversationContext(entries.map((entry) => ({ ...entry, text: "🙂".repeat(700) })), "Hi").messages)).length <= 16_000);
});

test("run report preserves unknown usage and names the actual retrieval method/sources", () => {
  const report = conversationReport({ ...response, sources: [{ id: "portfolio", title: "Portfolio guidance" }] });
  assert.match(report[0], /unknown tokens/);
  assert.match(report[1], /local, no embedding API call/);
  assert.match(report[2], /portfolio/);
});
