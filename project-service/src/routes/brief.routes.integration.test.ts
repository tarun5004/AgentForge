import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose, { Types } from "mongoose";
import { Project } from "../models/project.model.js";
import { ProjectBrief } from "../models/project-brief.model.js";
import { Generation } from "../models/generation.model.js";
import { Revision } from "../models/revision.model.js";

// No fallback to dotenv/application data, even when a developer forgets the test setting.
const testUri = process.env.AGENTFORGE_TEST_MONGODB_URI;
if (!testUri) throw new Error("Set an explicit dedicated local agentforge_test_* database.");
const uri = new URL(testUri);
if (uri.protocol !== "mongodb:" || !["localhost", "127.0.0.1"].includes(uri.hostname) ||
    !/^\/agentforge_test_[a-zA-Z0-9_]+$/.test(uri.pathname) || uri.username || uri.password || uri.search || uri.hash) {
  throw new Error("Brief tests require a dedicated local agentforge_test_* URI without credentials/options.");
}

const owner = "brief-test-owner";
const secret = "brief-test-only-access-secret";
const internal = "brief-test-only-internal-token";
const token = jwt.sign({ sub: owner }, secret, { algorithm: "HS256", expiresIn: "1h" });
const foreignToken = jwt.sign({ sub: "other-owner" }, secret, { expiresIn: "1h" });
const prompt = "Build my portfolio website";
const finalBrief = "Build a single-page portfolio for Ada, a frontend developer, with projects and contact sections.";
const answer = { question: "What is your name?", answer: "Ada" };
const fixtureIds: Types.ObjectId[] = [];
const requests: Record<string, unknown>[] = [];
let projectId: string;
let baseUrl: string;
let aiServer: Server;
let appServer: Server;
let responseMode = "needs";
let barrier: Promise<void> | undefined;
let release: (() => void) | undefined;
let arrived: (() => void) | undefined;
let generationCalls = 0;

// Delete only records created by this test run, never the whole database or unrelated projects.
async function cleanupFixtures() {
  await ProjectBrief.deleteMany({ projectId: { $in: fixtureIds } });
  await Revision.deleteMany({ projectId: { $in: fixtureIds } });
  await Generation.deleteMany({ projectId: { $in: fixtureIds } });
  await Project.deleteMany({ _id: { $in: fixtureIds } });
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.MONGODB_URI = testUri;
  process.env.ACCESS_TOKEN_SECRET = secret;
  process.env.INTERNAL_SERVICE_TOKEN = internal;
  process.env.BUILD_GATE_ENABLED = "false";
  process.env.EXECUTION_SERVICE_URL = "http://127.0.0.1:5100";
  delete process.env.EXECUTION_CHECK_TOKEN;
  await mongoose.connect(testUri, { serverSelectionTimeoutMS: 5000 });
  // Refuse a reused populated database before creating fixtures or changing indexes.
  for (const collection of [Project, ProjectBrief, Generation, Revision]) {
    if (await collection.collection.countDocuments({})) throw new Error("Use an empty dedicated test database.");
  }
  await Promise.all([Project.init(), ProjectBrief.init(), Generation.init(), Revision.init()]);
  // Only replace AI HTTP transport: authentication, routing, services and MongoDB are real.
  aiServer = createServer((req, res) => {
    if (req.method !== "POST" || req.headers["x-internal-service-token"] !== internal ||
        !["/internal/requirements", "/internal/generations"].includes(req.url ?? "")) {
      res.writeHead(401).end(); return;
    }
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", async () => {
      try {
        const input = JSON.parse(body) as Record<string, unknown>;
        if (req.url === "/internal/generations") {
          generationCalls++;
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ generation: {
            requestId: input.requestId, provider: "test-transport-fixture", model: "test-fixture",
            summary: "A portfolio generated from the confirmed test brief",
            files: [{ path: "app/page.tsx", content: "export default function Page() { return <main>Ada</main>; }" }],
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, latencyMs: 0,
          } }));
          requests.push({ ...input, generation: true }); return;
        }
        requests.push(input);
        const mode = responseMode;
        arrived?.();
        await barrier;
        if (mode === "error") { res.writeHead(500).end("fixture failure"); return; }
        if (mode === "redirect") { res.writeHead(307, { location: "/internal/requirements" }).end(); return; }
        if (mode === "oversized") { res.writeHead(200).end("x".repeat(20_001)); return; }
        const status = mode === "needs" ? "needs_clarification" : mode === "unsupported" ? "unsupported" : "ready";
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ assessment: {
          requestId: mode === "wrong-id" ? "wrong" : input.requestId, status,
          message: "Review the requirement assessment.", brief: finalBrief,
          questions: status === "needs_clarification" ? [answer.question] : [],
          policyVersion: "frontend-requirements-v1", model: "test-fixture",
          usage: { inputTokens: null, outputTokens: null, totalTokens: null }, latencyMs: 0,
        } }));
      } catch { res.writeHead(400).end(); }
    });
  }).listen(0, "127.0.0.1");
  await once(aiServer, "listening");
  process.env.AI_ORCHESTRATOR_URL = `http://127.0.0.1:${(aiServer.address() as AddressInfo).port}`;
  const { createApp } = await import("../app/app.js");
  appServer = createApp().listen(0, "127.0.0.1");
  await once(appServer, "listening");
  baseUrl = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}/api/projects`;
});

beforeEach(async () => {
  await cleanupFixtures();
  requests.length = 0;
  generationCalls = 0;
  responseMode = "needs";
  barrier = undefined; release = undefined; arrived = undefined;
  const project = await Project.create({ ownerId: owner, name: "Brief fixture", initialPrompt: prompt });
  fixtureIds.push(project._id);
  projectId = project.id;
});

afterEach(() => { release?.(); });
after(async () => {
  release?.();
  for (const server of [appServer, aiServer]) {
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  if (mongoose.connection.readyState === 1) {
    await cleanupFixtures();
    for (const collection of [Project, ProjectBrief, Generation, Revision]) {
      assert.equal(await collection.collection.countDocuments({}), 0, "Cleanup must leave no fixture records.");
    }
  }
  await mongoose.disconnect();
});

// Exercise the public HTTP contract, not private service shortcuts.
async function api(path = "/brief", method = "GET", body?: unknown, key?: string, accessToken: string | null = token, id = projectId) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (key) headers["idempotency-key"] = key;
  const response = await fetch(`${baseUrl}/${id}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}

// Pause only a fixture response so races are deterministic without timing sleeps.
function holdAssessment() {
  barrier = new Promise<void>((resolve) => { release = resolve; });
  return new Promise<void>((resolve) => { arrived = resolve; });
}

// Ready is deliberately separate from consent; tests explicitly cross both transitions.
async function readyBrief() {
  responseMode = "ready";
  const result = await api("/brief", "POST", { expectedVersion: 0 }, "ready");
  assert.equal(result.status, 200);
  return result.body.brief;
}

test("unique indexes exist before accepting assessment attempts", async () => {
  const indexes = await ProjectBrief.collection.listIndexes().toArray();
  for (const field of ["version", "idempotencyKey"]) {
    assert.ok(indexes.some((index) => index.unique && index.key.projectId === 1 && index.key[field] === 1));
  }
});

test("legacy projects read an empty brief; every new route requires authentication and ownership", async () => {
  assert.deepEqual((await api()).body, { brief: null });
  const id = new Types.ObjectId().toString();
  for (const [path, method, body] of [["/brief", "GET", undefined], ["/brief", "POST", { expectedVersion: 0 }],
    [`/brief/${id}/confirm`, "POST", {}], [`/brief/${id}/abandon`, "POST", {}], [`/brief/${id}/generations`, "POST", {}]] as const) {
    assert.equal((await api(path, method, body, "key", null)).status, 401);
    assert.equal((await api(path, method, body, "key", foreignToken)).status, 404);
  }
  assert.equal(requests.length, 0);
});

test("invalid input, query switches and legacy invalid prompt fail without AI or reservation", async () => {
  for (const body of [{}, { expectedVersion: -1 }, { expectedVersion: 0, ownerId: owner },
    { expectedVersion: 0, answers: [{ question: "Invented?", answer: "Yes" }] }]) {
    assert.equal((await api("/brief", "POST", body, "key")).status, 400);
  }
  assert.equal((await api("/brief", "POST", { expectedVersion: 0 })).status, 400);
  assert.equal((await api("/brief?ownerId=other")).status, 400);
  assert.equal((await api("/brief", "GET", undefined, undefined, token, "invalid")).status, 400);
  await Project.collection.updateOne({ _id: new Types.ObjectId(projectId) }, { $set: { initialPrompt: "x".repeat(1001) } });
  assert.equal((await api("/brief", "POST", { expectedVersion: 0 }, "legacy")).status, 400);
  assert.equal(await ProjectBrief.countDocuments({ projectId }), 0);
  assert.equal(requests.length, 0);
});

test("assessment/answers survive reconnect, hide internal identity and replay without another call", async () => {
  const first = await api("/brief", "POST", { expectedVersion: 0 }, "first");
  assert.equal(first.status, 200);
  assert.equal(first.body.brief.version, 1);
  assert.equal(first.body.brief.assessment.status, "needs_clarification");
  assert.equal(first.body.brief.confirmedAt, null);
  for (const field of ["idempotencyKey", "requestFingerprint", "ownerId", "__v"]) assert.equal(field in first.body.brief, false);
  responseMode = "ready";
  const second = await api("/brief", "POST", { expectedVersion: 1, answers: [answer] }, "second");
  assert.equal(second.status, 200);
  assert.deepEqual(requests[1]?.answers, [answer]);
  assert.equal(requests[1]?.prompt, prompt);
  await mongoose.disconnect();
  await mongoose.connect(testUri);
  assert.deepEqual((await api()).body.brief, second.body.brief);
  assert.deepEqual((await api("/brief", "POST", { expectedVersion: 0 }, "first")).body, first.body);
  assert.equal(requests.length, 2);
});

test("same key binds answers/version; invented or dropped answers and stale edits are rejected", async () => {
  await api("/brief", "POST", { expectedVersion: 0 }, "first");
  responseMode = "ready";
  const body = { expectedVersion: 1, answers: [answer] };
  await api("/brief", "POST", body, "second");
  assert.equal((await api("/brief", "POST", { ...body, answers: [{ ...answer, answer: "Bob" }] }, "second")).body.code, "IDEMPOTENCY_MISMATCH");
  assert.equal((await api("/brief", "POST", { expectedVersion: 2 }, "drop")).body.code, "INVALID_BRIEF_ANSWERS");
  assert.equal((await api("/brief", "POST", { expectedVersion: 2, answers: [answer, { question: "Invented?", answer: "Yes" }] }, "invent")).status, 400);
  assert.equal((await api("/brief", "POST", body, "stale")).body.code, "BRIEF_VERSION_CONFLICT");
  assert.equal(requests.length, 2);
});

test("same/different-key races reserve only one version and make only one AI request", async () => {
  const arrival = holdAssessment();
  const winner = api("/brief", "POST", { expectedVersion: 0 }, "same");
  await arrival;
  assert.equal((await api("/brief", "POST", { expectedVersion: 0 }, "same")).body.code, "BRIEF_IN_PROGRESS");
  assert.equal((await api("/brief", "POST", { expectedVersion: 0 }, "different")).status, 409);
  assert.equal((await api()).body.brief.status, "pending");
  release?.();
  const saved = await winner;
  assert.equal(saved.status, 200);
  assert.deepEqual((await api("/brief", "POST", { expectedVersion: 0 }, "same")).body, saved.body);
  assert.equal(await ProjectBrief.countDocuments({ projectId }), 1);
  assert.equal(requests.length, 1);
});

test("simultaneous distinct-key inserts enforce installed version uniqueness", async () => {
  const results = await Promise.all(["left", "right"].map((key) => api("/brief", "POST", { expectedVersion: 0 }, key)));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(await ProjectBrief.countDocuments({ projectId }), 1);
  assert.equal(requests.length, 1);
});

test("simultaneous same-key inserts converge to one record and one upstream attempt", async () => {
  const results = await Promise.all([1, 2].map(() => api("/brief", "POST", { expectedVersion: 0 }, "same")));
  assert.ok(results.some((result) => result.status === 200));
  assert.ok(results.every((result) => [200, 409].includes(result.status)));
  const replay = await api("/brief", "POST", { expectedVersion: 0 }, "same");
  assert.equal(replay.status, 200);
  assert.equal(await ProjectBrief.countDocuments({ projectId }), 1);
  assert.equal(requests.length, 1);
});

test("lost reservation acknowledgement leaves a recoverable pending intent, never a speculative AI call", async (context) => {
  const create = ProjectBrief.create.bind(ProjectBrief);
  context.mock.method(ProjectBrief, "create", async (...args: Parameters<typeof ProjectBrief.create>) => {
    await create(...args);
    throw new Error("fixture lost reservation acknowledgement");
  });
  const result = await api("/brief", "POST", { expectedVersion: 0 }, "lost-reservation");
  assert.equal(result.body.code, "BRIEF_IN_PROGRESS");
  assert.equal((await api()).body.brief.status, "pending");
  assert.equal(await ProjectBrief.countDocuments({ projectId }), 1);
  assert.equal(requests.length, 0);
});

test("lost completed-write acknowledgement is recovered by rereading, with one AI call", async (context) => {
  const update = ProjectBrief.collection.findOneAndUpdate.bind(ProjectBrief.collection);
  context.mock.method(ProjectBrief.collection, "findOneAndUpdate", async (...args: Parameters<typeof update>) => {
    await update(...args);
    throw new Error("fixture lost completed-write acknowledgement");
  });
  const result = await api("/brief", "POST", { expectedVersion: 0 }, "lost-completion");
  assert.equal(result.status, 200);
  assert.equal(result.body.brief.status, "completed");
  assert.deepEqual((await api("/brief", "POST", { expectedVersion: 0 }, "lost-completion")).body, result.body);
  assert.equal(requests.length, 1);
});

test("failed completion write preserves pending identity; explicit replay never repeats the paid boundary", async (context) => {
  context.mock.method(ProjectBrief.collection, "findOneAndUpdate", async () => {
    throw new Error("fixture write unavailable before completion");
  });
  const result = await api("/brief", "POST", { expectedVersion: 0 }, "write-unavailable");
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "OUTCOME_UNKNOWN");
  assert.equal((await api()).body.brief.status, "pending");
  assert.equal((await api("/brief", "POST", { expectedVersion: 0 }, "write-unavailable")).body.code, "BRIEF_IN_PROGRESS");
  assert.equal(requests.length, 1);
});

test("only ready current briefs can be confirmed; confirmation replay preserves its timestamp", async () => {
  const needs = await api("/brief", "POST", { expectedVersion: 0 }, "needs");
  assert.equal((await api(`/brief/${needs.body.brief.id}/confirm`, "POST", {})).body.code, "BRIEF_NOT_READY");
  responseMode = "ready";
  const ready = await api("/brief", "POST", { expectedVersion: 1, answers: [answer] }, "ready");
  const path = `/brief/${ready.body.brief.id}`;
  assert.equal((await api(`${path}/generations`, "POST", {}, "gen")).body.code, "BRIEF_NOT_CONFIRMED");
  assert.equal(generationCalls, 0);
  const confirmed = await api(`${path}/confirm`, "POST", {});
  assert.equal(confirmed.status, 200);
  assert.equal(typeof confirmed.body.brief.confirmedAt, "string");
  assert.deepEqual((await api(`${path}/confirm`, "POST", {})).body, confirmed.body);
  assert.equal((await api(`${path}/confirm`, "POST", { prompt: "override" })).status, 400);
  assert.equal(requests.length, 2);
});

test("answer edits create an unconfirmed version; an older confirmation cannot start new generation", async () => {
  await api("/brief", "POST", { expectedVersion: 0 }, "needs");
  responseMode = "ready";
  const ready = await api("/brief", "POST", { expectedVersion: 1, answers: [answer] }, "ready");
  const oldId = ready.body.brief.id;
  await api(`/brief/${oldId}/confirm`, "POST", {});
  const edited = await api("/brief", "POST", { expectedVersion: 2, answers: [{ ...answer, answer: "Bob" }] }, "edit");
  assert.equal(edited.body.brief.version, 3);
  assert.equal(edited.body.brief.confirmedAt, null);
  assert.equal((await api(`/brief/${oldId}/generations`, "POST", {}, "new-gen")).body.code, "BRIEF_VERSION_CONFLICT");
  assert.equal((await api(`/brief/${oldId}/confirm`, "POST", {})).status, 409);
  assert.equal(generationCalls, 0);
});

test("explicit abandonment blocks late completion and permits a deliberate new attempt", async () => {
  const arrival = holdAssessment();
  const pendingResponse = api("/brief", "POST", { expectedVersion: 0 }, "uncertain");
  await arrival;
  const id = (await api()).body.brief.id;
  const abandoned = await api(`/brief/${id}/abandon`, "POST", {});
  assert.equal(abandoned.body.brief.errorCode, "ASSESSMENT_ABANDONED");
  release?.();
  assert.deepEqual((await pendingResponse).body, abandoned.body);
  assert.deepEqual((await api("/brief", "POST", { expectedVersion: 0 }, "uncertain")).body, abandoned.body);
  responseMode = "ready";
  const next = await api("/brief", "POST", { expectedVersion: 1 }, "deliberate-new");
  assert.equal(next.body.brief.version, 2);
  assert.equal(requests.length, 2);
});

test("invalid/error/oversized/redirect responses persist failure; same-key replay never calls AI again", async () => {
  for (const [index, mode] of ["wrong-id", "error", "oversized", "redirect"].entries()) {
    responseMode = mode;
    const body = { expectedVersion: index };
    const result = await api("/brief", "POST", body, mode);
    assert.equal(result.status, 502);
    assert.equal(result.body.code, "ASSESSMENT_OUTCOME_UNKNOWN");
    const saved = await api();
    assert.equal(saved.body.brief.status, "failed");
    assert.equal(saved.body.brief.assessment, null);
    assert.deepEqual((await api("/brief", "POST", body, mode)).body, saved.body);
  }
  assert.equal(requests.length, 4);
  assert.equal(await Revision.countDocuments({ projectId }), 0);
});

test("unsupported is reviewable but cannot be confirmed or generate files", async () => {
  responseMode = "unsupported";
  const result = await api("/brief", "POST", { expectedVersion: 0 }, "unsupported");
  const id = result.body.brief.id;
  assert.equal((await api(`/brief/${id}/confirm`, "POST", {})).status, 409);
  assert.equal((await api(`/brief/${id}/generations`, "POST", {}, "gen")).status, 409);
  assert.equal(generationCalls, 0);
});

test("confirmed brief drives generation and historical same-key replay recovers the committed revision", async () => {
  const ready = await readyBrief();
  await api(`/brief/${ready.id}/confirm`, "POST", {});
  const path = `/brief/${ready.id}/generations`;
  const generated = await api(path, "POST", {}, "generate");
  assert.equal(generated.status, 201);
  assert.equal(generated.body.generation.sourcePrompt, finalBrief);
  assert.equal(generated.body.generation.revisionVersion, 1);
  const request = requests.find((item) => item.generation);
  assert.equal(request?.prompt, finalBrief);
  assert.notEqual(request?.prompt, prompt);
  await api("/brief", "POST", { expectedVersion: 1 }, "new-draft");
  assert.deepEqual((await api(path, "POST", {}, "generate")).body, generated.body);
  assert.equal((await api(path, "POST", {}, "new-generation")).status, 409);
  assert.equal(generationCalls, 1);
  assert.equal(await Revision.countDocuments({ projectId }), 1);
  assert.equal((await api(path, "POST", { prompt: "Override the brief" }, "override")).status, 400);
});

test("brief IDs are constrained to their project and are not a cross-owner lookup capability", async () => {
  const ready = await readyBrief();
  const other = await Project.create({ ownerId: owner, name: "Other project", initialPrompt: prompt });
  fixtureIds.push(other._id);
  for (const action of ["confirm", "abandon", "generations"]) {
    assert.equal((await api(`/brief/${ready.id}/${action}`, "POST", {}, "key", token, other.id)).status, 404);
    assert.equal((await api(`/brief/${ready.id}/${action}`, "POST", {}, "key", foreignToken)).status, 404);
  }
  assert.equal(requests.length, 1);
});
