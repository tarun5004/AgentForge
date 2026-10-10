import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose, { Types } from "mongoose";

import { Project } from "../models/project.model.js";
import { Revision } from "../models/revision.model.js";
import { Generation } from "../models/generation.model.js";

// Tests never fall back to the application's database or dotenv credentials.
const testUri = process.env.AGENTFORGE_TEST_MONGODB_URI;
if (!testUri) throw new Error("Set AGENTFORGE_TEST_MONGODB_URI to a dedicated local agentforge_test_* database.");
const parsedUri = new URL(testUri);
if (
  parsedUri.protocol !== "mongodb:" ||
  !["127.0.0.1", "localhost"].includes(parsedUri.hostname) ||
  !/^\/agentforge_test_[a-zA-Z0-9_]+$/.test(parsedUri.pathname) ||
  parsedUri.username || parsedUri.password || parsedUri.search
) throw new Error("Integration tests require an explicit local agentforge_test_* database without credentials or URI options.");

const owner = "000000000000000000000001";
const foreignOwner = "000000000000000000000002";
const secret = "slice-one-test-secret-never-used-in-production";
const token = jwt.sign({ sub: owner }, secret, { algorithm: "HS256", expiresIn: "1h" });
const projectIds = [1, 2, 3, 4].map((number) => new Types.ObjectId(`10000000000000000000000${number}`));
const revisionIds = [1, 2, 3, 4, 5].map((number) => new Types.ObjectId(`20000000000000000000000${number}`));
const cleanupProjectIds = [...projectIds];
const commands: string[] = [];
let server: Server;
let aiFixture: Server;
let baseUrl: string;
const aiRequests: Record<string, unknown>[] = [];

async function cleanupFixtures() {
  await Revision.deleteMany({ projectId: { $in: cleanupProjectIds } });
  await Generation.deleteMany({ projectId: { $in: cleanupProjectIds } });
  await Project.deleteMany({ _id: { $in: cleanupProjectIds } });
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.MONGODB_URI = testUri;
  process.env.ACCESS_TOKEN_SECRET = secret;
  process.env.INTERNAL_SERVICE_TOKEN = "slice-one-internal-test-token";
  await mongoose.connect(testUri, { serverSelectionTimeoutMS: 5_000, monitorCommands: true });
  await Promise.all([Project.init(), Revision.init(), Generation.init()]);
  // Replace only the AI network boundary: the Project API and MongoDB remain real.
  aiFixture = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/internal/generations" ||
      request.headers["x-internal-service-token"] !== "slice-one-internal-test-token") {
      response.writeHead(401).end();
      return;
    }
    let body = "";
    request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    request.on("end", () => {
      try {
        const input = JSON.parse(body) as Record<string, unknown>;
        aiRequests.push(input);
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
          generation: {
            requestId: input.requestId,
            provider: "test-transport-fixture",
            model: "deterministic-fixture",
            summary: "Initial generation regression fixture",
            files: [{ path: "app/page.tsx", content: 'export default function Page() { return <main>Portfolio</main>; }' }],
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            latencyMs: 0,
          },
        }));
      } catch { response.writeHead(400).end(); }
    });
  }).listen(0, "127.0.0.1");
  await once(aiFixture, "listening");
  process.env.AI_ORCHESTRATOR_URL = `http://127.0.0.1:${(aiFixture.address() as AddressInfo).port}`;
  const { createApp } = await import("../app/app.js");
  server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects`;
  mongoose.connection.getClient().on("commandStarted", (event) => {
    if (["find", "aggregate"].includes(event.commandName)) commands.push(event.commandName);
  });
});

beforeEach(async () => {
  await cleanupFixtures();
  aiRequests.length = 0;
  const january = new Date("2026-01-01T00:00:00.000Z");
  const february = new Date("2026-02-01T00:00:00.000Z");
  await Project.collection.insertMany(projectIds.map((id, index) => ({
    _id: id,
    ownerId: index === 3 ? foreignOwner : owner,
    name: `Project ${index + 1}`,
    initialPrompt: "Build a developer portfolio page",
    template: "nextjs",
    status: index === 0 ? "failed" : "ready",
    currentRevisionNumber: 99,
    createdAt: index === 0 ? january : february,
    updatedAt: february,
    privateNotes: "must not be returned",
  })));
  await Revision.collection.insertMany(revisionIds.map((id, index) => ({
    _id: id,
    projectId: index === 3 ? projectIds[3]! : index === 4 ? projectIds[1]! : projectIds[0]!,
    generationId: new Types.ObjectId(`30000000000000000000000${index + 1}`),
    version: index === 3 ? 50 : index === 4 ? 1 : index + 1,
    summary: `Saved revision ${index + 1}`,
    files: [{ path: "app/page.tsx", content: `private-file-content-${index + 1}` }],
    createdAt: january,
    updatedAt: february,
    internalNotes: "must not be returned",
  })));
  commands.length = 0;
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (aiFixture) await new Promise<void>((resolve, reject) => aiFixture.close((error) => error ? reject(error) : resolve()));
  if (mongoose.connection.readyState === 1) await cleanupFixtures();
  await mongoose.disconnect();
});

async function get(path = "", accessToken: string | null = token) {
  commands.length = 0;
  const response = await fetch(`${baseUrl}${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  return { status: response.status, body: await response.json() };
}

test("project reads require a valid access token", async () => {
  for (const path of ["", `/${projectIds[0]}`]) {
    for (const accessToken of [null, "invalid", jwt.sign({ sub: owner }, secret, { expiresIn: -1 })]) {
      const result = await get(path, accessToken);
      assert.equal(result.status, 401);
      assert.equal(commands.length, 0);
    }
  }
});

test("project pagination is owner-scoped and deterministic for equal timestamps", async () => {
  const first = await get("?limit=2");
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.projects.map((project: { id: string }) => project.id), [String(projectIds[2]), String(projectIds[1])]);
  assert.equal(commands.length, 2, "listing must batch latest revisions, not query once per project");
  assert.equal(typeof first.body.nextCursor, "string");
  assert.equal(JSON.stringify(first.body).includes("private-file-content"), false);
  assert.equal(JSON.stringify(first.body).includes("ownerId"), false);
  assert.equal(JSON.stringify(first.body).includes("privateNotes"), false);
  const second = await get(`?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.projects.map((project: { id: string }) => project.id), [String(projectIds[0])]);
  assert.equal(second.body.nextCursor, null);
  assert.equal(second.body.projects[0].latestRevision.version, 3);
});

test("project detail derives latest metadata from revisions rather than cached counters/status", async () => {
  const result = await get(`/${projectIds[0]}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.project.latestRevision.id, String(revisionIds[2]));
  assert.equal(result.body.project.latestRevision.version, 3);
  assert.equal(result.body.project.latestRevision.parentRevisionId, null);
  assert.equal(result.body.project.latestRevision.sourcePrompt, null);
  assert.equal("files" in result.body.project.latestRevision, false);
  assert.equal("currentRevisionNumber" in result.body.project, false);
  const noRevision = await get(`/${projectIds[2]}`);
  assert.equal(noRevision.body.project.latestRevision, null);
});

test("foreign and missing projects have the same 404 response and do not read revisions", async () => {
  const foreign = await get(`/${projectIds[3]}`);
  assert.equal(foreign.status, 404);
  assert.deepEqual(commands, ["find"]);
  const missing = await get("/ffffffffffffffffffffffff");
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, foreign.body);
  assert.deepEqual(commands, ["find"]);
});

test("invalid project IDs and pagination/query inputs fail before database access", async () => {
  const forgedCursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const paths = [
    "/invalid-id", "/123", `/${projectIds[0]}?ownerId=${foreignOwner}`,
    "?limit=0", "?limit=51", "?limit=-1", "?limit=1.5", "?limit=", "?limit=01",
    "?limit=1&limit=2", "?limit[x]=2", `?ownerId=${foreignOwner}`, "?sort=name",
    "?cursor=", "?cursor=not-json", "?cursor=" + "x".repeat(300),
    "?cursor=" + forgedCursor({ createdAt: "bad-date", id: String(projectIds[0]) }),
    "?cursor=" + forgedCursor({ createdAt: "2026-01-01T00:00:00.000Z", id: "bad-id" }),
    "?cursor=" + forgedCursor({ createdAt: "2026-01-01T00:00:00.000Z", id: String(projectIds[0]), ownerId: foreignOwner }),
  ];
  for (const path of paths) {
    const result = await get(path);
    assert.equal(result.status, 400, path);
    assert.equal(typeof result.body.message, "string");
    assert.equal(commands.length, 0, path);
  }
});

test("an owner without projects receives an empty page", async () => {
  const emptyToken = jwt.sign({ sub: "000000000000000000000003" }, secret);
  const result = await get("", emptyToken);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { projects: [], nextCursor: null });
  assert.deepEqual(commands, ["find"]);
});

test("project read responses reject oversized legacy metadata without truncating it", async () => {
  await Project.collection.updateOne({ _id: projectIds[0]! }, { $set: { initialPrompt: "x".repeat(1_048_576) } });
  for (const path of ["", `/${projectIds[0]}`]) {
    const result = await get(path);
    assert.equal(result.status, 413);
    assert.equal(JSON.stringify(result.body).length < 200, true);
  }
});

test("existing create-project behavior still returns a persisted draft owned by the token", async () => {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "Build a clean portfolio website", ownerId: foreignOwner }),
  });
  const body = await response.json();
  assert.equal(response.status, 201);
  cleanupProjectIds.push(new Types.ObjectId(body.project.id));
  assert.equal(body.project.status, "draft");
  const saved = await Project.findById(body.project.id);
  assert.equal(saved?.ownerId, owner);
  const read = await get(`/${body.project.id}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.project.latestRevision, null);
});

test("revision reads require a valid access token before any database access", async () => {
  for (const path of [`/${projectIds[0]}/revisions`, `/${projectIds[0]}/revisions/${revisionIds[0]}`]) {
    for (const accessToken of [null, "invalid", jwt.sign({ sub: owner }, secret, { expiresIn: -1 })]) {
      const result = await get(path, accessToken);
      assert.equal(result.status, 401);
      assert.equal(commands.length, 0);
    }
  }
});

test("revision history paginates newest-first and never includes full files or private fields", async () => {
  const first = await get(`/${projectIds[0]}/revisions?limit=2`);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.revisions.map((revision: { version: number }) => revision.version), [3, 2]);
  assert.equal(first.body.nextCursor, "2");
  assert.deepEqual(commands, ["find", "find"]);
  for (const revision of first.body.revisions) {
    assert.equal("files" in revision, false);
    assert.equal("internalNotes" in revision, false);
    assert.equal(revision.parentRevisionId, null);
    assert.equal(revision.sourcePrompt, null);
  }
  const second = await get(`/${projectIds[0]}/revisions?limit=2&beforeVersion=${first.body.nextCursor}`);
  assert.deepEqual(second.body.revisions.map((revision: { version: number }) => revision.version), [1]);
  assert.equal(second.body.nextCursor, null);
  const boundary = await get(`/${projectIds[0]}/revisions?beforeVersion=1`);
  assert.deepEqual(boundary.body, { revisions: [], nextCursor: null });
  const empty = await get(`/${projectIds[2]}/revisions`);
  assert.deepEqual(empty.body, { revisions: [], nextCursor: null });
});

test("revision detail returns exact saved files and unknown legacy provenance without mutating storage", async () => {
  const beforeRead = await Revision.collection.findOne({ _id: revisionIds[0]! });
  const result = await get(`/${projectIds[0]}/revisions/${revisionIds[0]}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.revision.id, String(revisionIds[0]));
  assert.equal(result.body.revision.projectId, String(projectIds[0]));
  assert.deepEqual(result.body.revision.files, [{ path: "app/page.tsx", content: "private-file-content-1" }]);
  assert.equal(result.body.revision.sourcePrompt, null);
  assert.equal(result.body.revision.parentRevisionId, null);
  assert.equal(result.body.revision.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal("internalNotes" in result.body.revision, false);
  assert.deepEqual(await Revision.collection.findOne({ _id: revisionIds[0]! }), beforeRead);
  await Revision.collection.updateOne({ _id: revisionIds[1]! }, {
    $set: { parentRevisionId: revisionIds[0]!, sourcePrompt: "Make the hero darker" },
  });
  const recorded = await get(`/${projectIds[0]}/revisions/${revisionIds[1]}`);
  assert.equal(recorded.body.revision.parentRevisionId, String(revisionIds[0]));
  assert.equal(recorded.body.revision.sourcePrompt, "Make the hero darker");
});

test("revision access conceals foreign projects and excludes revisions from every other project", async () => {
  const foreignHistory = await get(`/${projectIds[3]}/revisions`);
  assert.equal(foreignHistory.status, 404);
  assert.deepEqual(commands, ["find"]);
  const missingHistory = await get("/ffffffffffffffffffffffff/revisions");
  assert.deepEqual(missingHistory, foreignHistory);
  const foreignDetail = await get(`/${projectIds[3]}/revisions/${revisionIds[3]}`);
  assert.equal(foreignDetail.status, 404);
  assert.deepEqual(commands, ["find"]);
  for (const revisionId of [revisionIds[3], revisionIds[4], "ffffffffffffffffffffffff"]) {
    const result = await get(`/${projectIds[0]}/revisions/${revisionId}`);
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { message: "Revision not found." });
    assert.deepEqual(commands, ["find", "find"]);
  }
});

test("invalid revision IDs and history queries fail before database access", async () => {
  const paths = [
    "/bad/revisions", `/${projectIds[0]}/revisions/bad`, `/bad/revisions/${revisionIds[0]}`,
    `/${projectIds[0]}/revisions/${revisionIds[0]}?limit=2`,
    ...["limit=0", "limit=51", "limit=-1", "limit=1.5", "limit=", "limit=01", "limit=1&limit=2", "limit[x]=2",
      "beforeVersion=0", "beforeVersion=-1", "beforeVersion=1.5", "beforeVersion=01", "beforeVersion=",
      "beforeVersion=9007199254740992", "beforeVersion=1&beforeVersion=2", "beforeVersion[x]=2",
      "cursor=2", "ownerId=someone", "sort=version"].map((query) => `/${projectIds[0]}/revisions?${query}`),
  ];
  for (const path of paths) {
    const result = await get(path);
    assert.equal(result.status, 400, path);
    assert.equal(typeof result.body.message, "string");
    assert.equal(commands.length, 0, path);
  }
});

test("revision responses enforce byte bounds without truncating saved files", async () => {
  await Revision.collection.updateOne({ _id: revisionIds[0]! }, {
    $set: { files: [{ path: "app/page.tsx", content: "x".repeat(1_048_576) }] },
  });
  const oversized = await get(`/${projectIds[0]}/revisions/${revisionIds[0]}`);
  assert.equal(oversized.status, 413);
  assert.equal(JSON.stringify(oversized.body).length < 200, true);
  const history = await get(`/${projectIds[0]}/revisions`);
  assert.equal(history.status, 200, "large files must not be loaded into history responses");
  await Revision.collection.updateOne({ _id: revisionIds[0]! }, { $set: { summary: "x".repeat(1_048_576) } });
  assert.equal((await get(`/${projectIds[0]}/revisions`)).status, 413);
});

test("existing initial generation still publishes readable files and replays without a second AI call", async () => {
  const createResponse = await fetch(baseUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "Build a minimal portfolio website" }),
  });
  assert.equal(createResponse.status, 201);
  const { project } = await createResponse.json();
  cleanupProjectIds.push(new Types.ObjectId(project.id));
  const generate = () => fetch(`${baseUrl}/${project.id}/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": "slice-one-initial-regression" },
  });
  const response = await generate();
  assert.equal(response.status, 201);
  const { generation } = await response.json();
  assert.equal(generation.status, "ready");
  assert.equal(generation.revisionVersion, 1);
  assert.equal(aiRequests.length, 1);
  assert.equal(aiRequests[0]?.projectId, project.id);
  assert.equal(aiRequests[0]?.prompt, project.initialPrompt);
  assert.equal(aiRequests[0]?.template, "nextjs");
  const detail = await get(`/${project.id}`);
  assert.equal(detail.body.project.latestRevision.id, generation.revisionId);
  const saved = await get(`/${project.id}/revisions/${generation.revisionId}`);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.revision.files, generation.files);
  const replayResponse = await generate();
  assert.equal(replayResponse.status, 201);
  const replay = await replayResponse.json();
  assert.equal(replay.generation.revisionId, generation.revisionId);
  assert.equal(aiRequests.length, 1);
  assert.equal(await Revision.countDocuments({ projectId: project.id }), 1);
});
