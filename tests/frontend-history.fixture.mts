import { createServer } from "node:http";
import { once } from "node:events";
import mongoose from "mongoose";
import express from "express";
import { finishFixtureCleanup } from "./fixture-cleanup.mts";
import { registeredDemoUserId } from "./demo-accounts.mts";

// Run this ESM fixture with tsx; never fall back to .env or a normal application database.
const uri = process.env.AGENTFORGE_TEST_MONGODB_URI;
if (!uri) throw new Error("Set an explicit local agentforge_test_* database.");
const target = new URL(uri);
if (target.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(target.hostname) ||
  !/^\/agentforge_test_[a-zA-Z0-9_]+$/.test(target.pathname) || target.username || target.password || target.search) throw new Error("Unsafe test database target.");
await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
const db = mongoose.connection.db!;
for (const name of ["users", "projects", "revisions", "generations", "projectbriefs", "conversations"]) {
  if (await db.collection(name).countDocuments({}) !== 0) throw new Error("Browser fixture requires an initially empty dedicated database.");
}
Object.assign(process.env, {
  NODE_ENV: "test", PORT: "4311", MONGODB_URI: uri,
  ACCESS_TOKEN_SECRET: "frontend-fixture-access-not-for-production",
  REFRESH_TOKEN_SECRET: "frontend-fixture-refresh-not-for-production",
  ACCESS_TOKEN_EXPIRY: "15m", REFRESH_TOKEN_EXPIRY: "1h",
  AI_ORCHESTRATOR_URL: "http://127.0.0.1:4312", INTERNAL_SERVICE_TOKEN: "frontend-fixture-internal",
  // Isolate mode from developer env: old suites stay ungated; only the explicit gated suite enables it.
  BUILD_GATE_ENABLED: process.env.AGENTFORGE_TEST_BUILD_GATE === "1" ? "true" : "false",
  EXECUTION_CHECK_TOKEN: "frontend-fixture-execution-token-0001", EXECUTION_SERVICE_URL: "http://127.0.0.1:5310",
});
const { createApp: createAuthApp } = await import("../auth-service/src/app/app.ts");
const { createApp: createProjectApp } = await import("../project-service/src/app/app.ts");
await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
const previewEnabled = process.env.AGENTFORGE_TEST_PREVIEW === "1";
const buildGateEnabled = process.env.AGENTFORGE_TEST_BUILD_GATE === "1";
if (buildGateEnabled && !previewEnabled) throw new Error("Build-gate browser tests require the real preview controller.");
const initialFiles = [
  { path: "app/page.tsx", content: "export default function Page() { return <main>Initial portfolio</main>; }" },
  { path: "app/globals.css", content: "body { color: white; }" },
  { path: "components/Old.tsx", content: "export default function Old() { return null; }" },
];
// Only the opt-in preview suite needs an interactive build fixture; old history fixtures stay stable.
if (previewEnabled) {
  initialFiles[0]!.content = `'use client';
import { useState } from 'react';
export default function Page() {
  const [count, setCount] = useState(0);
  return <main><h1>Zero-cost portfolio preview</h1><button onClick={() => setCount(count + 1)}>Count {count}</button></main>;
}`;
}
if (buildGateEnabled) initialFiles[1]!.content = "body { background: rgb(12, 34, 56); color: white; }";
let previewController: Awaited<ReturnType<typeof import("./frontend-preview.fixture.mts").startPreviewFixture>> | undefined;
if (previewEnabled) {
  const { startPreviewFixture } = await import("./frontend-preview.fixture.mts");
  previewController = await startPreviewFixture(buildGateEnabled);
}
const aiRequests: { prompt: string; baseVersion: number | null; baseMatchesInitial: boolean }[] = [];
const fixtureEmail = "frontend-slice5-20261012@agentforge.test";
const fixtureEmails = [fixtureEmail, "revision-loop-other@agentforge.test"];
const fixtureId = "agentforge-real-revision-loop-v1";
const demoMode = process.env.AGENTFORGE_LOCAL_DEMO === "1";
const demoUserIds = new Set<string>();
let holdNextGeneration = false;
let releaseGeneration: (() => void) | undefined;
let holdNextChat = false;
let releaseChat: (() => void) | undefined;
let conversationCalls = 0;

// Real Auth/Project APIs and Mongo run unchanged; only the paid AI network boundary is replaced.
const aiServer = createServer((request, response) => {
  // A deterministic barrier proves text reached the browser before model completion.
  if (request.method === "POST" && request.url === "/__fixture/hold-chat") { holdNextChat = true; response.end("armed"); return; }
  if (request.method === "POST" && request.url === "/__fixture/release-chat") { releaseChat?.(); response.end("released"); return; }
  if (request.method === "POST" && ["/__fixture/hold-check", "/__fixture/release-check"].includes(request.url ?? "")) {
    if (!buildGateEnabled || !previewController) { response.writeHead(409).end(); return; }
    try {
      if (request.url === "/__fixture/hold-check") previewController.holdNextCheck();
      else previewController.releaseCheck();
      response.end("ok");
    } catch { response.writeHead(409).end(); }
    return;
  }
  // Deterministic test barriers replace timing guesses; they exist only in this fixture.
  if (request.method === "POST" && request.url === "/__fixture/hold-next") {
    if (holdNextGeneration || releaseGeneration) { response.writeHead(409).end(); return; }
    holdNextGeneration = true;
    response.end("armed"); return;
  }
  if (request.method === "POST" && request.url === "/__fixture/release") {
    if (!releaseGeneration) { response.writeHead(409).end(); return; }
    releaseGeneration();
    response.end("released"); return;
  }
  if (request.method === "GET" && request.url === "/__fixture") {
    // A runner checks identity and empty state before sending test credentials to any API.
    void readFixtureStatus(response);
    return;
  }
  if (request.method === "POST" && request.url === "/__fixture/shutdown") {
    response.end("cleanup starting");
    void shutdown();
    return;
  }
  if (request.method !== "POST" || !["/internal/generations", "/internal/requirements", "/internal/conversations", "/internal/conversations/stream"].includes(request.url ?? "") || request.headers["x-internal-service-token"] !== "frontend-fixture-internal") {
    response.writeHead(404).end(); return;
  }
  let body = "";
  request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
  request.on("end", async () => {
    try {
      const input = JSON.parse(body);
      if (request.url === "/internal/conversations/stream") {
        conversationCalls++;
        const prompt = input.messages.at(-1)?.content;
        if (typeof prompt !== "string" || !prompt.length || prompt.length > 1000) throw new Error("Invalid fixture chat.");
        const action = /^(hi\b|hello\b)|plan only/i.test(prompt) ? "reply" : "build";
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write(`event: start\ndata: ${JSON.stringify({ requestId: input.requestId })}\n\n`);
        response.write(`event: message\ndata: ${JSON.stringify({ message: "Early streamed reply" })}\n\n`);
        if (holdNextChat) {
          holdNextChat = false;
          await new Promise<void>((resolve) => { releaseChat = resolve; response.on("close", resolve); });
          releaseChat = undefined;
        }
        if (response.destroyed) return;
        response.end(`event: complete\ndata: ${JSON.stringify({ response: {
          requestId: input.requestId, action, message: action === "reply" ? "Hello! We can plan before building." : "I will build the requested frontend change.", prompt: action === "build" ? prompt : null,
          sources: [], retrieval: { method: "lexical", embeddingModel: null, inputTokens: 0 }, model: "deterministic-fixture",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, latencyMs: 0,
        } })}\n\n`);
        return;
      }
      // Conversation decisions are a separate fixture boundary, not generated-code evidence.
      if (request.url === "/internal/conversations") {
        const prompt = input.messages.at(-1)?.content;
        if (typeof prompt !== "string" || prompt.length < 10 || prompt.length > 1000) throw new Error("Fixture requires a bounded build request.");
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ response: {
          requestId: input.requestId, action: "build", message: "I will build the requested frontend change.", prompt,
          sources: [], retrieval: { method: "lexical", embeddingModel: null, inputTokens: 0 }, model: "deterministic-fixture",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, latencyMs: 0,
        } }));
        return;
      }
      // Contract fixture only: real model question quality is intentionally not simulated or claimed.
      if (request.url === "/internal/requirements") {
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ assessment: {
          requestId: input.requestId, status: "ready", message: "Review this fixture brief before generating.",
          brief: input.prompt, questions: [], policyVersion: "frontend-requirements-v1", model: "deterministic-fixture",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, latencyMs: 0,
        } }));
        return;
      }
      const baseFiles = input.baseRevision?.files ?? [];
      aiRequests.push({ prompt: input.prompt, baseVersion: input.baseRevision?.version ?? null,
        baseMatchesInitial: JSON.stringify([...baseFiles].sort((a, b) => a.path.localeCompare(b.path))) ===
          JSON.stringify([...initialFiles].sort((a, b) => a.path.localeCompare(b.path))),
      });
      if (holdNextGeneration) {
        holdNextGeneration = false;
        await new Promise<void>((resolve) => { releaseGeneration = resolve; });
        releaseGeneration = undefined;
      }
      if (input.prompt.includes("slow")) await new Promise((resolve) => setTimeout(resolve, 2_000));
      const initial = !input.baseRevision;
      const files = previewEnabled && input.prompt.includes("broken preview syntax")
        ? [{ path: "app/page.tsx", content: "export default function Page( { deliberately invalid TSX !!!" }]
        : input.prompt.includes("invalid output") ? [] : initial ? initialFiles :
        [{ path: "app/page.tsx", content: `export default function Page() { return <main>Revised portfolio ${aiRequests.length}</main>; }` }];
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ generation: {
        requestId: input.requestId, provider: "browser-test-fixture", model: "deterministic-fixture",
        summary: initial ? "Initial saved portfolio snapshot" : "Targeted saved portfolio revision",
        files, deletedPaths: !initial && input.prompt.includes("remove old") ? ["components/Old.tsx"] : [],
        validation: { policyVersion: "frontend-manifest-v1", status: "manifest_validated" },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, latencyMs: 0,
      } }));
    } catch { response.writeHead(500).end(); }
  });
}).listen(4312, "127.0.0.1");
const authApp = createAuthApp();
const fixtureAuth = express();
if (demoMode) {
  // The wrapper observes IDs without changing production auth or capturing passwords/tokens.
  fixtureAuth.use((request, response, next) => {
    const sendJson = response.json.bind(response);
    response.json = (body: unknown) => {
      const id = registeredDemoUserId(request.method, request.originalUrl, response.statusCode, body);
      if (id) demoUserIds.add(id);
      return sendJson(body);
    };
    next();
  });
}
fixtureAuth.use(authApp);
const projectApp = createProjectApp();
// Next must forward these markers: otherwise the runner refuses to write through its rewrites.
const authServer = createServer((request, response) => {
  response.setHeader("x-agentforge-test-fixture", fixtureId);
  fixtureAuth(request, response);
}).listen(4310, "127.0.0.1");
const projectServer = createServer((request, response) => {
  response.setHeader("x-agentforge-test-fixture", fixtureId);
  projectApp(request, response);
}).listen(4311, "127.0.0.1");
await Promise.all([once(aiServer, "listening"), once(authServer, "listening"), once(projectServer, "listening")]);
console.info("Browser fixture ready: real Auth :4310, Project :4311, deterministic AI :4312.");
console.info(demoMode ? "MANUAL DEMO: AI responses are fixtures. Registered demo accounts are deleted on exit; use disposable details only."
  : `Use only test email ${fixtureEmail}; no live provider keys are required.`);

let stopping = false;
// Report only safe fixture metadata/counts, never documents, tokens or the database URI.
async function readFixtureStatus(response: import("node:http").ServerResponse) {
  try {
    const counts: Record<string, number> = {};
    for (const name of ["users", "projects", "revisions", "generations", "projectbriefs", "conversations"]) counts[name] = await db.collection(name).countDocuments({});
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ fixtureId, databaseName: target.pathname.slice(1), counts, aiRequests, conversationCalls, heldGeneration: !!releaseGeneration,
      previewEnabled, buildGateEnabled, demoMode, checks: previewController?.checkEvidence() ?? null }));
  } catch { response.writeHead(503).end("Fixture status unavailable."); }
}
// Remove only fixed fixture accounts/observed demo registrations and their owned records, never unknown data.
async function shutdown() {
  if (stopping) return;
  stopping = true;
  // A failed browser must not leave server.close waiting on a held model request forever.
  releaseGeneration?.();
  releaseChat?.();
  process.exitCode = await finishFixtureCleanup(async () => {
    await previewController?.stop();
    const { drainCandidatePublications } = await import("../project-service/src/services/generation.build-gate.ts");
    await drainCandidatePublications();
    await Promise.all([aiServer, authServer, projectServer].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    const users = await db.collection("users").find({ $or: [
      { email: { $in: fixtureEmails } },
      { _id: { $in: [...demoUserIds].map((id) => new mongoose.Types.ObjectId(id)) } },
    ] }, { projection: { _id: 1 } }).toArray();
    const ownerIds = users.map((user) => user._id.toString());
    await db.collection("conversations").deleteMany({ ownerId: { $in: ownerIds } });
    const projects = await db.collection("projects").find({ ownerId: { $in: ownerIds } }, { projection: { _id: 1 } }).toArray();
    const projectIds = projects.map((project) => project._id);
    await db.collection("revisions").deleteMany({ projectId: { $in: projectIds } });
    await db.collection("generations").deleteMany({ projectId: { $in: projectIds } });
    await db.collection("projectbriefs").deleteMany({ projectId: { $in: projectIds } });
    await db.collection("projects").deleteMany({ _id: { $in: projectIds } });
    await db.collection("users").deleteMany({ _id: { $in: users.map((user) => user._id) } });
    const counts: Record<string, number> = {};
    for (const name of ["users", "projects", "revisions", "generations", "projectbriefs", "conversations"]) counts[name] = await db.collection(name).countDocuments({});
    console.info(JSON.stringify({ fixtureCleanup: counts }));
    // Never widen deletion filters to remove someone else's unexpected records.
    if (Object.values(counts).some((count) => count !== 0)) throw new Error("Fixture data remains after scoped cleanup.");
  }, () => mongoose.disconnect());
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
