import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { before, after, test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { Project } from "../models/project.model.js";
import { Generation } from "../models/generation.model.js";
import { Revision } from "../models/revision.model.js";
import { candidateHash } from "../clients/build-verification.js";

// Never fall back to application data; every fixture is scoped to IDs this file creates.
const uri = process.env.AGENTFORGE_TEST_MONGODB_URI;
if (!uri) throw new Error("Explicit dedicated local agentforge_test_* database required.");
const target = new URL(uri);
if (target.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(target.hostname) ||
  !/^\/agentforge_test_[a-zA-Z0-9_]+$/.test(target.pathname) || target.username || target.password || target.search) throw new Error("Unsafe test database.");
const secret = "build-gate-test-access-secret-only";
const serviceToken = "build-gate-test-service-token-00001";
const owner = "000000000000000000000081";
const headers = { authorization: `Bearer ${jwt.sign({ sub: owner }, secret, { expiresIn: "1h" })}`, "Content-Type": "application/json" };
const foreign = `Bearer ${jwt.sign({ sub: "000000000000000000000082" }, secret, { expiresIn: "1h" })}`;
const ids: string[] = [];
const servers: Server[] = [];
let origin: string;
let aiCalls = 0; let builds = 0; let mode = "pass";
let buildStarted: () => void = () => {};
let buildBarrier: Promise<void> = Promise.resolve();
type Runner = { imageId?: string; build(input: { id: string; previewPath: string; signal: AbortSignal; revision: { id: string; projectId: string; files: { path: string; content: string }[] } }): Promise<Map<string, unknown>> };
let checks: { close(): Promise<void> };
let realRunner: Runner | undefined;

// Ephemeral loopback transports exercise real APIs; only model output/build execution use fixtures by default.
async function listen(server: Server): Promise<string> {
  servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error();
  return `http://127.0.0.1:${address.port}`;
}

before(async () => {
  Object.assign(process.env, { NODE_ENV: "test", LOG_LEVEL: "silent", MONGODB_URI: uri,
    ACCESS_TOKEN_SECRET: secret, INTERNAL_SERVICE_TOKEN: "build-gate-ai-fixture-token", BUILD_GATE_ENABLED: "true", EXECUTION_CHECK_TOKEN: serviceToken });
  const aiOrigin = await listen(createServer((req, res) => {
    assert.equal(req.url, "/internal/generations");
    assert.equal(req.headers["x-internal-service-token"], "build-gate-ai-fixture-token");
    let body = ""; req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      aiCalls++; const input = JSON.parse(body) as { requestId: string };
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ generation: { requestId: input.requestId, provider: "test-transport", model: "fixed-fixture",
        summary: "Candidate fixture", files: [{ path: "app/page.tsx", content: `export default function Page() { return <main>Fixture ${aiCalls}</main>; }` }],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, latencyMs: 0 } }));
    });
  }));
  process.env.AI_ORCHESTRATOR_URL = aiOrigin;
  // Allocate the Execution listener before importing Project's startup-validated URL config.
  const executionServer = createServer();
  process.env.EXECUTION_SERVICE_URL = await listen(executionServer);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
  await Promise.all([Project.init(), Revision.init(), Generation.init()]);
  const { createApp } = await import("../app/app.js");
  origin = await listen(createServer(createApp()));
  // Consume Execution's built public module boundary, not TypeScript outside this workspace's rootDir.
  const executionPath = "../../../execution-service/dist/";
  const { createCandidateChecks, createCandidateClient } = await import(executionPath + "features/runs/candidate.check.js");
  const { createDockerRunner } = await import(executionPath + "features/runs/docker.runner.js");
  const { RunBuildError, RunError } = await import(executionPath + "features/runs/run.errors.js");
  if (process.env.RUN_DOCKER_TESTS === "1") realRunner = await createDockerRunner(process.env.PREVIEW_RUNNER_IMAGE ?? "agentforge-preview-runner:local");
  const runner: Runner = { imageId: realRunner?.imageId ?? `sha256:${"b".repeat(64)}`, async build(input) {
    builds++; buildStarted(); await buildBarrier;
    if (mode === "fail") throw new RunBuildError("compile");
    if (mode === "busy") throw new RunError(429, "BUILD_BUSY", "Busy.");
    if (mode === "real" && realRunner) return realRunner.build(input);
    return new Map();
  } };
  checks = createCandidateChecks(runner, createCandidateClient(origin, serviceToken));
  const { createApp: createExecutionApp } = await import(executionPath + "app/app.js");
  executionServer.on("request", createExecutionApp(undefined, { checks, token: serviceToken }));
});

after(async () => {
  buildBarrier = Promise.resolve();
  const { drainCandidatePublications } = await import("../services/generation.build-gate.js");
  await drainCandidatePublications(); await checks?.close();
  for (const server of servers) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  await Revision.deleteMany({ projectId: { $in: ids } });
  await Generation.deleteMany({ projectId: { $in: ids } });
  await Project.deleteMany({ _id: { $in: ids } });
  await mongoose.disconnect();
});

// Create a real owned draft so every candidate/publication test starts from the public API.
async function draft(): Promise<string> {
  const response = await fetch(`${origin}/api/projects`, { method: "POST", headers, body: JSON.stringify({ prompt: "Build a simple portfolio frontend" }) });
  assert.equal(response.status, 201); const body = await response.json() as { project: { id: string } };
  ids.push(body.project.id); return body.project.id;
}

// Keep keys stable across explicit retries; neither this helper nor status polling silently generates a new one.
async function generate(projectId: string, key: string, body: unknown = {}) {
  return fetch(`${origin}/api/projects/${projectId}/generations`, { method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(body) });
}

// GET status is side-effect free; a bounded wait observes only persisted evidence.
async function terminal(projectId: string, id: string, timeoutMs = 10_000): Promise<Record<string, any>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${origin}/api/projects/${projectId}/generations/${id}`, { headers });
    assert.equal(response.status, 200);
    const { generation } = await response.json() as { generation: Record<string, any> };
    if (generation.status !== "pending") return generation;
    await new Promise((resolve) => setTimeout(resolve, timeoutMs > 10_000 ? 500 : 30));
  }
  throw new Error("Candidate did not reach a terminal status within test deadline.");
}

test("202 keeps candidate unpublished, both credentials enforce ownership, then exact evidence survives replay", async () => {
  const projectId = await draft(); const beforeAI = aiCalls;
  let release!: () => void;
  buildBarrier = new Promise<void>((resolve) => { release = resolve; });
  const arrived = new Promise<void>((resolve) => { buildStarted = resolve; });
  try {
    const response = await generate(projectId, "candidate-accepted"); assert.equal(response.status, 202);
    const { generation } = await response.json(); await arrived;
    assert.equal(await Revision.countDocuments({ projectId }), 0);
    const duplicate = await generate(projectId, "candidate-accepted");
    assert.equal(duplicate.status, 202); assert.equal((await duplicate.json()).generation.id, generation.id);
    assert.equal((await generate(projectId, "candidate-accepted", { prompt: "A different request under the same key" })).status, 409);
    const candidateUrl = `${origin}/internal/projects/${projectId}/generations/${generation.id}/candidate`;
    assert.equal((await fetch(candidateUrl, { headers })).status, 403);
    assert.equal((await fetch(candidateUrl, { headers: { authorization: foreign, "x-execution-check-token": serviceToken } })).status, 404);
    const candidate = await fetch(candidateUrl, { headers: { ...headers, "x-execution-check-token": serviceToken } });
    assert.equal(candidate.status, 200); assert.equal(candidate.headers.get("cache-control"), "no-store");
    const checkCount = builds;
    await fetch(`${origin}/api/projects/${projectId}/generations/${generation.id}`, { headers });
    assert.equal(builds, checkCount); assert.equal(aiCalls, beforeAI + 1);
    // Even a direct internal publisher call cannot skip the proof guard.
    const { publishGeneration } = await import("../services/generation.publication.js");
    const saved = await Generation.findById(generation.id).lean();
    assert(saved); await assert.rejects(publishGeneration(saved));
    release(); const ready = await terminal(projectId, generation.id);
    assert.equal(ready.status, "ready"); assert.equal(ready.revisionVersion, 1);
    assert.equal(ready.buildVerification.snapshotHash, candidateHash(ready.files));
    const replay = await generate(projectId, "candidate-accepted"); assert.equal(replay.status, 201);
    assert.equal((await replay.json()).generation.revisionId, ready.revisionId);
    const revisionResponse = await fetch(`${origin}/api/projects/${projectId}/revisions/${ready.revisionId}`, { headers });
    assert.deepEqual((await revisionResponse.json()).revision.buildVerification, ready.buildVerification);
    assert.equal(aiCalls, beforeAI + 1); assert.equal(builds, checkCount);
    const stored = await Generation.findById(generation.id).lean();
    assert(!JSON.stringify(stored).includes(headers.authorization));
  } finally { release(); buildBarrier = Promise.resolve(); buildStarted = () => {}; }
});

test("failed follow-up publishes nothing and keeps prior files/latest revision unchanged", async () => {
  mode = "pass"; const projectId = await draft();
  const first = (await (await generate(projectId, "first-pass")).json()).generation;
  const v1 = await terminal(projectId, first.id);
  mode = "fail";
  const attempt = (await (await generate(projectId, "failed-follow-up", { prompt: "Make the saved page darker", baseRevisionId: v1.revisionId })).json()).generation;
  const failed = await terminal(projectId, attempt.id);
  assert.equal(failed.status, "failed"); assert.equal(failed.errorCode, "BUILD_VERIFICATION_FAILED");
  assert.equal(await Revision.countDocuments({ projectId }), 1);
  assert.deepEqual((await Revision.findById(v1.revisionId).lean())?.files, v1.files);
  mode = "pass";
});

test("busy check retains paid output; captured gate survives flag-off and same-key retry avoids AI", async () => {
  mode = "busy"; const projectId = await draft(); const beforeAI = aiCalls;
  const attempt = (await (await generate(projectId, "busy-retry")).json()).generation;
  const { env } = await import("../config/env.js");
  env.BUILD_GATE_ENABLED = false;
  try {
    const saved = await Generation.findById(attempt.id).lean(); assert(saved?.result);
    const { publishGeneration } = await import("../services/generation.publication.js");
    await assert.rejects(publishGeneration(saved));
    assert.equal(await Revision.countDocuments({ projectId }), 0);
    mode = "pass";
    // Replays can briefly join the finishing busy worker; retry only the same saved request.
    let ready: Record<string, any> | undefined;
    for (let i = 0; i < 50; i++) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const response = await generate(projectId, "busy-retry");
      const generation = (await response.json()).generation;
      if (generation?.status === "ready") { ready = generation; break; }
    }
    assert.equal(ready?.status, "ready"); assert.equal(aiCalls, beforeAI + 1);
    assert.equal(await Revision.countDocuments({ projectId }), 1);
  } finally { env.BUILD_GATE_ENABLED = true; mode = "pass"; }
});

test("publication outage after saved proof replays without another model or build", async () => {
  const projectId = await draft(); const beforeAI = aiCalls; const beforeBuilds = builds;
  const original = Revision.create;
  let failedInsert!: () => void;
  const arrived = new Promise<void>((resolve) => { failedInsert = resolve; });
  // Test-only DB seam: the actual insert did not happen; saved evidence must survive.
  Revision.create = (async () => { failedInsert(); throw new Error("fixture write unavailable"); }) as typeof Revision.create;
  let id: string;
  try {
    id = (await (await generate(projectId, "saved-proof-retry")).json()).generation.id;
    await arrived;
  } finally { Revision.create = original; }
  let ready: Record<string, any> | undefined;
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    const response = await generate(projectId, "saved-proof-retry");
    const generation = (await response.json()).generation;
    if (generation?.status === "ready") { ready = generation; break; }
  }
  assert.equal(ready?.id, id); assert.equal(aiCalls, beforeAI + 1); assert.equal(builds, beforeBuilds + 1);
});

test("competing checked candidates cannot silently publish sequential revisions", async () => {
  const projectId = await draft();
  const first = (await (await generate(projectId, "race-base")).json()).generation;
  const base = await terminal(projectId, first.id);
  let release!: () => void;
  buildBarrier = new Promise<void>((resolve) => { release = resolve; });
  try {
    const body = { prompt: "Make a new frontend change", baseRevisionId: base.revisionId };
    const [a, b] = await Promise.all([generate(projectId, "race-a", body), generate(projectId, "race-b", body)]);
    assert.equal(a.status, 202); assert.equal(b.status, 202);
    const ga = (await a.json()).generation; const gb = (await b.json()).generation;
    release();
    const outcomes = await Promise.all([terminal(projectId, ga.id), terminal(projectId, gb.id)]);
    assert.equal(outcomes.filter((value) => value.status === "ready").length, 1);
    assert.equal(outcomes.filter((value) => value.status === "failed" && value.errorCode === "REVISION_CONFLICT").length, 1);
    assert.equal(await Revision.countDocuments({ projectId }), 2);
  } finally { release(); buildBarrier = Promise.resolve(); }
});

test("real Project + Mongo + Execution + Docker publishes only a checked candidate", { skip: process.env.RUN_DOCKER_TESTS !== "1", timeout: 200_000 }, async () => {
  mode = "real";
  try {
    const projectId = await draft();
    const response = await generate(projectId, "real-docker-gate"); assert.equal(response.status, 202);
    const { generation } = await response.json(); const ready = await terminal(projectId, generation.id, 180_000);
    assert.equal(ready.status, "ready"); assert.equal(ready.buildVerification.runnerImageId, realRunner?.imageId);
    assert.equal(await Revision.countDocuments({ projectId }), 1);
  } finally { mode = "pass"; }
});
