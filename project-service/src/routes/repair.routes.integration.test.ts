import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { before, after, test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { Generation } from "../models/generation.model.js";
import { Project } from "../models/project.model.js";
import { Revision } from "../models/revision.model.js";
import { candidateHash } from "../clients/build-verification.js";

const uri = process.env.AGENTFORGE_TEST_MONGODB_URI;
if (!uri) throw new Error("Explicit dedicated local agentforge_test_* database required.");
const target = new URL(uri);
if (target.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(target.hostname) ||
  !/^\/agentforge_test_[a-zA-Z0-9_]+$/.test(target.pathname) || target.username || target.password || target.search) throw new Error("Unsafe test database.");
const accessSecret = "repair-integration-access-only";
const serviceToken = "repair-integration-execution-token-0001";
const owner = "000000000000000000000091";
const headers = { "Content-Type": "application/json", authorization: `Bearer ${jwt.sign({ sub: owner }, accessSecret, { expiresIn: "1h" })}` };
const foreign = `Bearer ${jwt.sign({ sub: "000000000000000000000092" }, accessSecret, { expiresIn: "1h" })}`;
const servers: Server[] = []; const ids: string[] = [];
const feedback = [{ path: "app/page.tsx", line: 1, column: 49, category: "typescript", code: "TS2304" }];
let origin: string; let aiCalls = 0; let repairCalls = 0; let builds = 0;
let buildMode = "pass"; let repairMode = "valid";
let aiBarrier: Promise<void> = Promise.resolve(); let releaseAI = () => {};
let checks: { close(): Promise<void> };
let realRunner: { imageId?: string; build(input: unknown): Promise<Map<string, unknown>> } | undefined;

// Real loopback APIs and Mongo exercise lifecycle rules; fake model/build responses are labelled fixtures.
async function listen(server: Server): Promise<string> {
  servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

before(async () => {
  Object.assign(process.env, { NODE_ENV: "test", MONGODB_URI: uri, ACCESS_TOKEN_SECRET: accessSecret,
    INTERNAL_SERVICE_TOKEN: "repair-ai-fixture-only", BUILD_GATE_ENABLED: "true", REPAIR_ENABLED: "true", EXECUTION_CHECK_TOKEN: serviceToken });
  const ai = await listen(createServer((req, res) => {
    assert.ok(req.url === "/internal/generations" || req.url === "/internal/repairs");
    assert.equal(req.headers["x-internal-service-token"], "repair-ai-fixture-only");
    let text = ""; req.on("data", (chunk) => { text += chunk.toString(); });
    req.on("end", async () => {
      const input = JSON.parse(text); const repair = req.url === "/internal/repairs";
      if (repair) {
        repairCalls++;
        if (buildMode === "real") assert.ok(input.diagnostics.some((row: { path: string }) => row.path === "app/page.tsx"));
        else assert.deepEqual(input.diagnostics, feedback);
        assert.equal(input.failedFiles.length, 1);
        assert.ok(!("authorization" in input));
        await aiBarrier;
        if (repairMode === "outage") { res.writeHead(503).end("PRIVATE_PROVIDER"); return; }
      } else aiCalls++;
      const content = repair ? `export default function Page() { return <h1>Repaired ${repairCalls}</h1> }`
        : buildMode === "real" ? "export default function Page() { return <h1>{missing}</h1> }"
        : `export default function Page() { return <h1>Original ${aiCalls}</h1> }`;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ generation: { requestId: input.requestId, provider: "test-transport", model: "repair-fixture",
        summary: "Deterministic repair integration fixture", files: [{ path: repairMode === "unsafe" && repair ? "app/api/route.ts" : "app/page.tsx", content }],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, latencyMs: 0 } }));
    });
  }));
  process.env.AI_ORCHESTRATOR_URL = ai;
  const executionServer = createServer(); process.env.EXECUTION_SERVICE_URL = await listen(executionServer);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
  // Refuse a reused nonempty database before creating test records or deleting anything.
  for (const count of await Promise.all([Project.countDocuments({}), Generation.countDocuments({}), Revision.countDocuments({})])) {
    assert.equal(count, 0, "Dedicated test DB must be empty.");
  }
  await Promise.all([Project.init(), Generation.init(), Revision.init()]);
  const { createApp } = await import("../app/app.js"); origin = await listen(createServer(createApp()));
  const execution = "../../../execution-service/dist/";
  const { createCandidateChecks, createCandidateClient } = await import(execution + "features/runs/candidate.check.js");
  const { RunBuildError, RunError } = await import(execution + "features/runs/run.errors.js");
  if (process.env.RUN_DOCKER_TESTS === "1") {
    const { createDockerRunner } = await import(execution + "features/runs/docker.runner.js");
    realRunner = await createDockerRunner(process.env.PREVIEW_RUNNER_IMAGE ?? "agentforge-preview-runner:local");
  }
  checks = createCandidateChecks({ imageId: realRunner?.imageId ?? `sha256:${"b".repeat(64)}`, async build(input: unknown) {
    builds++;
    if (buildMode === "fail") throw new RunBuildError("compile", "command_failed", feedback);
    if (buildMode === "busy") throw new RunError(429, "BUILD_BUSY", "Busy.");
    if (buildMode === "real") return realRunner!.build(input);
    return new Map();
  } }, createCandidateClient(origin, serviceToken));
  const { createApp: executionApp } = await import(execution + "app/app.js");
  executionServer.on("request", executionApp(undefined, { checks, token: serviceToken }));
});

after(async () => {
  releaseAI();
  const { drainCandidatePublications } = await import("../services/generation.build-gate.js");
  await drainCandidatePublications(); await checks?.close();
  for (const server of servers) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  if (mongoose.connection.readyState === 1) {
    await Revision.deleteMany({ projectId: { $in: ids } }); await Generation.deleteMany({ projectId: { $in: ids } });
    await Project.deleteMany({ _id: { $in: ids } }); await mongoose.disconnect();
  }
});

// Use public creation/generation paths so admission, authentication and publication are not bypassed.
async function draft(): Promise<string> {
  const response = await fetch(`${origin}/api/projects`, { method: "POST", headers, body: JSON.stringify({ prompt: "Build a simple portfolio frontend" }) });
  assert.equal(response.status, 201); const id = (await response.json()).project.id; ids.push(id); return id;
}

// Stable keys make deliberately repeated requests distinguishable from new paid work.
async function generate(projectId: string, key: string, body: unknown = {}) {
  const response = await fetch(`${origin}/api/projects/${projectId}/generations`, { method: "POST",
    headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(body) });
  assert.equal(response.status, 202); return (await response.json()).generation;
}

// Repair accepts only an empty body; owner source and feedback are always loaded server-side.
async function repair(projectId: string, id: string, key: string, body: unknown = {}, authorization = headers.authorization) {
  return fetch(`${origin}/api/projects/${projectId}/generations/${id}/repair`, { method: "POST",
    headers: { ...headers, authorization, "Idempotency-Key": key }, body: JSON.stringify(body) });
}

// A bounded status wait observes persisted state without repeating inference or build work.
async function terminal(projectId: string, id: string, timeoutMs = 10_000): Promise<Record<string, any>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${origin}/api/projects/${projectId}/generations/${id}`, { headers });
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const { generation } = await response.json(); if (generation.status !== "pending") return generation;
    await new Promise((resolve) => setTimeout(resolve, timeoutMs > 10_000 ? 500 : 30));
  }
  throw new Error("Attempt did not reach a terminal state.");
}

// Keep the old good revision available when testing a failed follow-up and its explicit repair.
async function failedFollowup() {
  buildMode = "pass"; repairMode = "valid";
  const projectId = await draft(); const first = await generate(projectId, "first");
  const base = await terminal(projectId, first.id);
  buildMode = "fail";
  const failed = await generate(projectId, "broken-followup", { prompt: "Make the portfolio more colorful", baseRevisionId: base.revisionId });
  const status = await terminal(projectId, failed.id);
  assert.equal(status.status, "failed"); assert.equal(status.repairAvailable, true);
  return { projectId, base, failed };
}

test("Mongo enforces one sparse repair slot; disabled mode and foreign/raw input make zero repair calls", async () => {
  const indexes = await Generation.collection.indexes();
  assert.ok(indexes.some((index) => index.key.repairOf === 1 && index.unique && index.sparse));
  const { projectId, failed } = await failedFollowup(); const before = repairCalls;
  const { env } = await import("../config/env.js"); env.REPAIR_ENABLED = false;
  try { assert.equal((await repair(projectId, failed.id, "disabled")).status, 409); }
  finally { env.REPAIR_ENABLED = true; }
  assert.equal((await repair(projectId, failed.id, "foreign", {}, foreign)).status, 404);
  assert.equal((await repair(projectId, failed.id, "forged", { diagnostics: feedback })).status, 400);
  assert.equal(repairCalls, before); assert.equal(await Generation.countDocuments({ repairOf: failed.id }), 0);
});

test("racing keys and duplicate clicks reserve one call; new proof gates publication and replay is free", async () => {
  const { projectId, base, failed } = await failedFollowup(); const before = repairCalls; const beforeBuilds = builds;
  aiBarrier = new Promise<void>((resolve) => { releaseAI = resolve; }); buildMode = "pass";
  const pending = repair(projectId, failed.id, "one-repair");
  try {
    for (let i = 0; repairCalls === before && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(repairCalls, before + 1);
    const same = await repair(projectId, failed.id, "one-repair"); assert.equal(same.status, 409);
    assert.equal((await repair(projectId, failed.id, "different-key")).status, 409);
    assert.equal(await Revision.countDocuments({ projectId }), 1);
  } finally { releaseAI(); aiBarrier = Promise.resolve(); }
  const response = await pending; assert.equal(response.status, 202);
  const attempt = (await response.json()).generation;
  const ready = await terminal(projectId, attempt.id);
  assert.equal(ready.status, "ready"); assert.equal(ready.revisionVersion, 2);
  assert.equal(ready.parentRevisionId, base.revisionId);
  assert.equal(ready.buildVerification.snapshotHash, candidateHash(ready.files));
  assert.equal(builds, beforeBuilds + 1);
  const replay = await repair(projectId, failed.id, "one-repair"); assert.equal(replay.status, 201);
  assert.equal((await replay.json()).generation.revisionId, ready.revisionId);
  assert.equal(repairCalls, before + 1); assert.equal(await Generation.countDocuments({ repairOf: failed.id }), 1);
  assert.deepEqual((await Revision.findById(base.revisionId).lean())?.files, base.files);
  assert.equal((await Generation.findById(failed.id).lean())?.status, "failed");
  const parent = await terminal(projectId, failed.id);
  assert.equal(parent.repairAvailable, false); assert.equal(parent.repairAttemptId, attempt.id);
  const stored = await Generation.findById(attempt.id).lean();
  assert.doesNotMatch(JSON.stringify(stored), /Bearer|PRIVATE_PROVIDER|PRIVATE_LOG/);
});

test("failed repair cannot recurse and never replaces the previous good revision", async () => {
  const { projectId, base, failed } = await failedFollowup(); const before = repairCalls;
  const response = await repair(projectId, failed.id, "repair-also-fails"); assert.equal(response.status, 202);
  const attempt = (await response.json()).generation; const status = await terminal(projectId, attempt.id);
  assert.equal(status.status, "failed"); assert.equal(status.repairAvailable, false);
  assert.equal((await repair(projectId, attempt.id, "recursive")).status, 409);
  assert.equal((await repair(projectId, failed.id, "second-repair")).status, 409);
  assert.equal(repairCalls, before + 1); assert.equal(await Revision.countDocuments({ projectId }), 1);
  assert.deepEqual((await Revision.findById(base.revisionId).lean())?.files, base.files);
});

test("provider failure and unsafe output consume the reserved attempt with no second model call", async () => {
  for (const mode of ["outage", "unsafe"]) {
    const { projectId, base, failed } = await failedFollowup(); repairMode = mode; const before = repairCalls;
    const response = await repair(projectId, failed.id, "invalid-repair"); assert.equal(response.status, 502);
    const body = await response.json(); assert.equal(body.code, "AI_REPAIR_FAILED");
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE_PROVIDER/);
    assert.equal((await repair(projectId, failed.id, "invalid-repair")).status, 409);
    assert.equal((await repair(projectId, failed.id, "another-key")).status, 409);
    assert.equal(repairCalls, before + 1); assert.equal(await Revision.countDocuments({ projectId }), 1);
    assert.deepEqual((await Revision.findById(base.revisionId).lean())?.files, base.files);
  }
  repairMode = "valid";
});

test("uncertain build outcomes are not repairable and changed heads stop before spending", async () => {
  const { projectId, base, failed } = await failedFollowup(); const before = repairCalls;
  buildMode = "pass";
  await terminal(projectId, (await generate(projectId, "new-head", { prompt: "Make another successful change", baseRevisionId: base.revisionId })).id);
  const conflict = await repair(projectId, failed.id, "stale-repair");
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, "REVISION_CONFLICT");
  buildMode = "busy"; const other = await draft(); const pending = await generate(other, "busy-attempt");
  assert.equal((await repair(other, pending.id, "dont-repair-infra")).status, 409);
  assert.equal(repairCalls, before); buildMode = "pass";
});

test("lost result acknowledgements never repeat inference, whether the write happened or not", async () => {
  for (const writeHappened of [false, true]) {
    const { projectId, base, failed } = await failedFollowup(); buildMode = "pass"; const before = repairCalls;
    const originalUpdate = Generation.updateOne;
    let injected = false;
    // Fail only the result save, not admission or terminal bookkeeping; restore the seam before replay.
    Generation.updateOne = (async (filter: Record<string, unknown>, update: Record<string, any>, options: Record<string, unknown>) => {
      if (update.$set?.result && !injected) {
        injected = true;
        if (writeHappened) await Reflect.apply(originalUpdate, Generation, [filter, update, options]);
        throw new Error("test-only lost write acknowledgement");
      }
      return Reflect.apply(originalUpdate, Generation, [filter, update, options]);
    }) as typeof Generation.updateOne;
    let response: Response;
    try { response = await repair(projectId, failed.id, "lost-save"); }
    finally { Generation.updateOne = originalUpdate; }
    assert.equal(response.status, 503); assert.ok(injected);
    const attempt = await Generation.findOne({ repairOf: failed.id }).lean(); assert.ok(attempt);
    assert.equal(attempt.status, "pending"); assert.equal(!!attempt.result, writeHappened);
    const replay = await repair(projectId, failed.id, "lost-save");
    if (writeHappened) {
      assert.equal(replay.status, 202);
      assert.equal((await terminal(projectId, attempt._id.toString())).status, "ready");
    } else {
      assert.equal(replay.status, 409); assert.equal((await replay.json()).code, "GENERATION_IN_PROGRESS");
      assert.equal(await Revision.countDocuments({ projectId }), 1);
    }
    assert.equal(repairCalls, before + 1);
    assert.equal((await repair(projectId, failed.id, "try-another-key")).status, 409);
    assert.deepEqual((await Revision.findById(base.revisionId).lean())?.files, base.files);
  }
});

test("disabling flags cannot bypass the fresh build on an already reserved repair", async () => {
  const { projectId, failed } = await failedFollowup(); const before = repairCalls; const beforeBuilds = builds;
  const { env } = await import("../config/env.js");
  aiBarrier = new Promise<void>((resolve) => { releaseAI = resolve; });
  const pending = repair(projectId, failed.id, "captured-gate-repair");
  try {
    for (let i = 0; repairCalls === before && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(repairCalls, before + 1);
    env.REPAIR_ENABLED = false; env.BUILD_GATE_ENABLED = false; releaseAI(); aiBarrier = Promise.resolve();
    const response = await pending; assert.equal(response.status, 202);
    const attempt = (await response.json()).generation; const result = await terminal(projectId, attempt.id);
    assert.equal(result.status, "failed"); assert.equal(builds, beforeBuilds + 1);
    assert.equal(await Revision.countDocuments({ projectId }), 1);
  } finally { releaseAI(); aiBarrier = Promise.resolve(); env.REPAIR_ENABLED = true; env.BUILD_GATE_ENABLED = true; }
});

test("real Docker compile failure can be explicitly repaired and published only after a new real build", {
  skip: process.env.RUN_DOCKER_TESTS !== "1", timeout: 360_000,
}, async () => {
  buildMode = "real"; repairMode = "valid";
  try {
    const projectId = await draft(); const original = await generate(projectId, "real-broken-source");
    const failed = await terminal(projectId, original.id, 180_000);
    assert.equal(failed.status, "failed"); assert.equal(failed.repairAvailable, true);
    const stored = await Generation.findById(original.id).lean();
    assert.ok(stored?.buildDiagnostics?.some((row) => row.path === "app/page.tsx"));
    assert.equal(await Revision.countDocuments({ projectId }), 0);
    const response = await repair(projectId, original.id, "real-one-repair"); assert.equal(response.status, 202);
    const ready = await terminal(projectId, (await response.json()).generation.id, 180_000);
    assert.equal(ready.status, "ready"); assert.equal(ready.revisionVersion, 1);
    assert.equal(ready.buildVerification.runnerImageId, realRunner?.imageId);
    assert.equal(ready.buildVerification.snapshotHash, candidateHash(ready.files));
  } finally { buildMode = "pass"; }
});
