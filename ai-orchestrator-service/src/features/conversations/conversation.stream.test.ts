import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

process.env.AI_PROVIDER = "gateway";
process.env.AI_MODEL = "google/gemini-2.5-flash";
process.env.AI_GATEWAY_API_KEY = "stream-test-not-real";
process.env.INTERNAL_SERVICE_TOKEN = "stream-test-internal";
process.env.PORT = "6001";
process.env.RAG_RETRIEVAL_MODE = "lexical";
const realFetch = globalThis.fetch;
// SDK fixtures cannot accidentally reach a paid provider during this suite.
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== "127.0.0.1") throw new Error("Tests refuse external network.");
  return realFetch(input, init);
};
after(() => { globalThis.fetch = realFetch; });
const { streamConversation } = await import("./conversation.service.js");
const { createApp } = await import("../../app.js");
const request = { requestId: "stream-1", messages: [{ role: "user" as const, content: "Hi buddy!" }] };
const headers = { "content-type": "application/json", "x-internal-service-token": "stream-test-internal" };

// Character fragments exercise actual SDK partial-JSON parsing, not a fake preassembled application response.
function streamingModel(output: unknown) {
  return new MockLanguageModelV4({ doStream: {
    stream: simulateReadableStream({ initialDelayInMs: 0, chunkDelayInMs: 0, chunks: [
      { type: "text-start" as const, id: "text-1" },
      ...Array.from(JSON.stringify(output), (delta) => ({ type: "text-delta" as const, id: "text-1", delta })),
      { type: "text-end" as const, id: "text-1" },
      { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      } },
    ] }),
  } });
}

test("SDK emits provisional message snapshots then one validated final decision with usage", async () => {
  const message = "Hello buddy! We can plan your portfolio together.";
  const model = streamingModel({ action: "reply", message, prompt: null });
  const snapshots: string[] = [];
  const response = await streamConversation(request, async (text) => { snapshots.push(text); }, AbortSignal.timeout(5000), model);
  assert.ok(snapshots.length > 1);
  assert.ok(snapshots.some((text) => text.length > 0 && text.length < message.length));
  assert.equal(response.message, message);
  assert.equal(response.action, "reply");
  assert.deepEqual(response.usage, { inputTokens: 10, outputTokens: 20, totalTokens: 30 });
  assert.equal(model.doStreamCalls.length, 1);
  assert.equal(model.doStreamCalls[0]?.maxOutputTokens, 2000);
  assert.equal(model.doGenerateCalls.length, 0);
});

test("wire snapshots are capped, but final text is not truncated", async () => {
  const message = "a".repeat(200);
  const snapshots: string[] = [];
  const response = await streamConversation(request, async (text) => { snapshots.push(text); }, AbortSignal.timeout(5000), streamingModel({ action: "reply", message, prompt: null }));
  assert.ok(snapshots.length <= 64);
  assert.equal(response.message, message);
});

test("partial build action cannot bypass final cross-field validation", async () => {
  const snapshots: string[] = [];
  await assert.rejects(streamConversation(request, async (text) => { snapshots.push(text); }, AbortSignal.timeout(5000), streamingModel({ action: "build", message: "I will build it.", prompt: null })), /invalid conversation/);
  assert.ok(snapshots.length > 0);
});

test("provider errors have no retry, and pre-aborted requests never call a model", async () => {
  const model = new MockLanguageModelV4({ doStream: async () => { throw new APICallError({ message: "private provider error", url: "https://invalid.local", requestBodyValues: {}, statusCode: 503 }); } });
  await assert.rejects(streamConversation(request, async () => {}, AbortSignal.timeout(5000), model));
  assert.equal(model.doStreamCalls.length, 1);
  const unused = streamingModel({ action: "reply", message: "Hello", prompt: null });
  await assert.rejects(streamConversation(request, async () => {}, AbortSignal.abort(), unused));
  assert.equal(unused.doStreamCalls.length, 0);
});

test("a failed output sink aborts SDK work without an automatic second attempt", async () => {
  const model = streamingModel({ action: "reply", message: "Hello buddy!", prompt: null });
  await assert.rejects(streamConversation(request, async () => { throw new Error("Reader failed."); }, AbortSignal.timeout(5000), model), /Reader failed/);
  assert.equal(model.doStreamCalls.length, 1);
  assert.equal(model.doStreamCalls[0]?.abortSignal?.aborted, true);
});

test("HTTP auth/input errors stay JSON; valid stream frames escape newlines and finish once", async (t) => {
  let calls = 0;
  const server = createApp(undefined, undefined, async (input, emit, signal) => {
    calls++;
    return streamConversation(input, emit, signal, streamingModel({ action: "reply", message: "Hello\n\nevent: complete", prompt: null }));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); return new Promise<void>((resolve) => server.close(() => resolve())); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/conversations/stream`;
  assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
  const invalid = await fetch(url, { method: "POST", headers, body: JSON.stringify({ ...request, ownerId: "forged" }) });
  assert.equal(invalid.status, 400);
  assert.match(invalid.headers.get("content-type")!, /application\/json/);
  assert.equal(calls, 0);
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(request) });
  assert.match(response.headers.get("content-type")!, /text\/event-stream/);
  assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
  const frames = (await response.text()).trim().split("\n\n");
  const events = frames.map((frame) => {
    const [name, data] = frame.split("\n");
    return { name, data: JSON.parse(data!.slice(6)) };
  });
  assert.equal(events[0]?.name, "event: start");
  assert.equal(events.filter(({ name }) => name === "event: complete").length, 1);
  assert.equal(events.at(-1)?.data.response.message, "Hello\n\nevent: complete");
  assert.equal(calls, 1);
});

test("HTTP streaming failure emits sanitized error, never complete or raw provider data", async (t) => {
  const server = createApp(undefined, undefined, async (_input, emit) => {
    await emit("Provisional text");
    throw new Error("private token=secret provider failure");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); return new Promise<void>((resolve) => server.close(() => resolve())); });
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/conversations/stream`, { method: "POST", headers, body: JSON.stringify(request) });
  const text = await response.text();
  assert.match(text, /event: error/);
  assert.ok(!text.includes("event: complete"));
  assert.ok(!text.includes("private"));
  assert.ok(!text.includes("secret"));
});

test("HTTP delivers provisional text before final inference finishes, not a buffered fake stream", async (t) => {
  let release!: () => void;
  const finish = new Promise<void>((resolve) => { release = resolve; });
  const server = createApp(undefined, undefined, async (input, emit, signal) => {
    await emit("Visible before completion");
    await finish;
    return streamConversation(input, emit, signal, streamingModel({ action: "reply", message: "Final response", prompt: null }));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { release(); server.closeAllConnections(); return new Promise<void>((resolve) => server.close(() => resolve())); });
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/conversations/stream`, {
    method: "POST", headers, body: JSON.stringify(request), signal: AbortSignal.timeout(5000),
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("Visible before completion")) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    text += decoder.decode(chunk.value, { stream: true });
  }
  assert.ok(!text.includes("event: complete"));
  release();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  assert.equal(text.match(/event: complete/g)?.length, 1);
});

test("disconnect aborts the upstream signal instead of leaving generation running intentionally", async (t) => {
  let observeAbort!: () => void;
  const aborted = new Promise<void>((resolve) => { observeAbort = resolve; });
  const server = createApp(undefined, undefined, async (_input, emit, signal) => {
    await emit("Hello");
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => { observeAbort(); resolve(); }, { once: true });
    });
    signal.throwIfAborted();
    throw new Error("unreachable");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); return new Promise<void>((resolve) => server.close(() => resolve())); });
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/conversations/stream`, { method: "POST", headers, body: JSON.stringify(request) });
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  await Promise.race([aborted, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("Disconnect did not abort upstream.")), 2000); timer.unref(); })]);
});
