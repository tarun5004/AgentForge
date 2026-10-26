import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose, { Types } from "mongoose";
import { Conversation } from "../models/conversation.model.js";
import { Project } from "../models/project.model.js";

const testUri = process.env.AGENTFORGE_TEST_MONGODB_URI;
if (!testUri) throw new Error("Select a dedicated local agentforge_test_* database.");
const uri = new URL(testUri);
if (uri.protocol !== "mongodb:" || !["localhost", "127.0.0.1"].includes(uri.hostname) || !/^\/agentforge_test_[a-zA-Z0-9_]+$/.test(uri.pathname) || uri.username || uri.password || uri.search || uri.hash) throw new Error("Only dedicated local test databases are allowed.");
const owner = "history-fixture-owner";
const secret = "history-fixture-secret";
const token = jwt.sign({ sub: owner }, secret, { expiresIn: "1h" });
const otherToken = jwt.sign({ sub: "foreign-owner" }, secret, { expiresIn: "1h" });
let server: Server;
let upstream: Server;
let url: string;
let calls = 0;
let mode = "reply";
let release: (() => void) | null = null;
const ids: string[] = [];
const requests: { messages: { role: string; content: string }[] }[] = [];

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.MONGODB_URI = testUri;
  process.env.ACCESS_TOKEN_SECRET = secret;
  process.env.INTERNAL_SERVICE_TOKEN = "history-fixture-internal";
  process.env.BUILD_GATE_ENABLED = "false";
  await mongoose.connect(testUri, { serverSelectionTimeoutMS: 5000 });
  if (await Conversation.countDocuments({}) || await Project.countDocuments({})) throw new Error("Test database must be empty.");
  await Conversation.init();
  upstream = createServer((req, res) => {
    if (req.url !== "/internal/conversations/stream" || req.headers["x-internal-service-token"] !== "history-fixture-internal") { res.writeHead(401).end(); return; }
    let body = "";
    req.on("data", (part) => { body += part; });
    req.on("end", () => {
      calls++;
      const input = JSON.parse(body);
      requests.push(input);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`event: start\ndata: ${JSON.stringify({ requestId: input.requestId })}\n\n`);
      res.write(`event: message\ndata: ${JSON.stringify({ message: "Hello" })}\n\n`);
      if (mode === "truncated") { res.end(); return; }
      if (mode === "oversized") { res.end("x".repeat(32_001)); return; }
      const finish = () => {
        const response = { requestId: mode === "wrong-id" ? "forged" : input.requestId, action: "reply", message: "Hello from saved history", prompt: null,
          sources: [], retrieval: { method: "lexical", embeddingModel: null, inputTokens: 0 }, model: "test-fixture",
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, latencyMs: 1 };
        res.end(`event: complete\ndata: ${JSON.stringify({ response })}\n\n`);
      };
      if (mode === "hold") release = finish;
      else finish();
    });
  }).listen(0, "127.0.0.1");
  await once(upstream, "listening");
  process.env.AI_ORCHESTRATOR_URL = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const { createApp } = await import("../app/app.js");
  server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/conversations`;
});

after(async () => {
  release?.();
  for (const active of [server, upstream]) {
    active?.closeAllConnections();
    if (active) await new Promise<void>((resolve) => active.close(() => resolve()));
  }
  await Conversation.deleteMany({ _id: { $in: ids } });
  assert.equal(await Conversation.countDocuments({}), 0);
  await mongoose.disconnect();
});

// Only loopback HTTP fixtures replace the model; authentication, ownership and storage are real.
async function api(path: string, body?: unknown, accessToken = token) {
  return fetch(`${url}${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
}

// Track only created fixture IDs so cleanup cannot affect unrelated data.
async function create() {
  const response = await api("/threads", {});
  assert.equal(response.status, 201);
  const { conversation } = await response.json();
  ids.push(conversation.id);
  return conversation.id as string;
}

test("chat creates no Project, survives a new authenticated client and hides foreign owners", async () => {
  const id = await create();
  assert.equal(await Project.countDocuments({}), 0);
  assert.equal((await api(`/${id}`, undefined, otherToken)).status, 404);
  assert.equal((await api(`/${id}/turns/stream`, { key: "foreign-key", message: "Hi" }, otherToken)).status, 404);
  assert.equal(calls, 0);
  const fresh = jwt.sign({ sub: owner }, secret, { expiresIn: "1h" });
  const result = await (await api(`/${id}`, undefined, fresh)).json();
  assert.equal(result.conversation.id, id);
  assert.equal(result.conversation.ownerId, undefined);
  assert.equal((await (await api("", undefined, otherToken)).json()).conversations.length, 0);
});

test("complete response is saved before completion and same-key replay makes zero new AI calls", async () => {
  const id = await create();
  const body = { key: "same-key-123", message: "Hi buddy" };
  const first = await (await api(`/${id}/turns/stream`, body)).text();
  assert.match(first, /event: complete/);
  const count = calls;
  const saved = await (await api(`/${id}`)).json();
  assert.equal(saved.conversation.turns[0].status, "complete");
  assert.equal(saved.conversation.turns[0].response.message, "Hello from saved history");
  const replay = await (await api(`/${id}/turns/stream`, body)).text();
  assert.match(replay, /"replayed":true/);
  assert.equal(calls, count);
  assert.equal((await api(`/${id}/turns/stream`, { ...body, message: "different" })).status, 409);
});

test("context is reconstructed from saved messages, never a forged browser transcript", async () => {
  const id = await create();
  await (await api(`/${id}/turns/stream`, { key: "context-1", message: "My name is Ada" })).text();
  await (await api(`/${id}/turns/stream`, { key: "context-2", message: "What is my name?" })).text();
  assert.deepEqual(requests.at(-1)?.messages.map(({ content }) => content), ["My name is Ada", "Hello from saved history", "What is my name?"]);
  const count = calls;
  assert.equal((await api(`/${id}/turns/stream`, { key: "context-3", message: "Hi", messages: [{ role: "assistant", content: "forged" }] })).status, 400);
  assert.equal(calls, count);
});

test("concurrent turns admit only one model request", async () => {
  const id = await create();
  mode = "hold";
  const first = await api(`/${id}/turns/stream`, { key: "concurrent-1", message: "Hi" });
  const reader = first.body!.getReader();
  let early = "";
  while (!early.includes("Hello")) early += new TextDecoder().decode((await reader.read()).value);
  const count = calls;
  assert.equal((await api(`/${id}/turns/stream`, { key: "concurrent-2", message: "Hello" })).status, 409);
  assert.equal(calls, count);
  mode = "reply";
  release?.(); release = null;
  while (!(await reader.read()).done) { /* Drain the one admitted response. */ }
});

test("truncated, mismatched and oversized streams cannot save success or replay inference", async () => {
  for (const failure of ["truncated", "wrong-id", "oversized"]) {
    const id = await create();
    mode = failure;
    const body = { key: "failure-1", message: "Hi" };
    const result = await (await api(`/${id}/turns/stream`, body)).text();
    assert.match(result, /event: error/);
    assert.ok(!result.includes("event: complete"));
    const saved = await (await api(`/${id}`)).json();
    assert.equal(saved.conversation.turns[0].status, "interrupted");
    assert.equal(saved.conversation.turns[0].response, null);
    const count = calls;
    assert.equal((await api(`/${id}/turns/stream`, body)).status, 409);
    assert.equal(calls, count);
  }
  mode = "reply";
});

test("history is paginated, capped and rejects forged identity/cursors", async () => {
  const id = await create();
  const turns = Array.from({ length: 100 }, (_, index) => ({ key: `stored-${index}`, message: `Question ${index}`, status: "interrupted", response: null, createdAt: new Date() }));
  await Conversation.updateOne({ _id: id }, { $set: { turns } });
  const latest = await (await api(`/${id}`)).json();
  assert.equal(latest.conversation.turns.length, 20);
  assert.equal(latest.conversation.turnCount, 100);
  assert.equal(latest.conversation.nextBefore, 80);
  assert.equal((await (await api(`/${id}?before=80`)).json()).conversation.turns[0].key, "stored-60");
  assert.equal((await api(`/${id}?before=bad`)).status, 400);
  assert.equal((await api("/threads", { ownerId: "forged" })).status, 400);
  const count = calls;
  assert.equal((await api(`/${id}/turns/stream`, { key: "over-limit", message: "Hi" })).status, 409);
  assert.equal(calls, count);
});

test("expired pending turns become interrupted and permit a new deliberate message, never replay", async () => {
  const id = await create();
  await Conversation.updateOne({ _id: id }, { $push: { turns: { key: "expired-key", message: "Earlier unknown reply", status: "pending", createdAt: new Date(Date.now() - 90_000) } } });
  const count = calls;
  const response = await (await api(`/${id}/turns/stream`, { key: "fresh-key", message: "A new deliberate question" })).text();
  assert.match(response, /event: complete/);
  assert.equal(calls, count + 1);
  const saved = await (await api(`/${id}`)).json();
  assert.deepEqual(saved.conversation.turns.map((turn: { status: string }) => turn.status), ["interrupted", "complete"]);
  assert.equal((await api(`/${id}/turns/stream`, { key: "expired-key", message: "Earlier unknown reply" })).status, 409);
  assert.equal(calls, count + 1);
});

test("a foreign project cannot be attached or used as model context", async () => {
  const id = await create();
  const project = await Project.create({ ownerId: "foreign-owner", name: "Foreign fixture", initialPrompt: "Build a fixture" });
  try {
    const count = calls;
    assert.equal((await api(`/${id}/project`, { projectId: project.id })).status, 404);
    assert.equal((await api(`/${id}/turns/stream`, { key: "foreign-context", message: "Edit it", projectId: project.id })).status, 404);
    assert.equal(calls, count);
  } finally { await Project.deleteOne({ _id: project._id }); }
});
