import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import jwt from "jsonwebtoken";
import mongoose, { Types } from "mongoose";

import { Project } from "../models/project.model.js";
import { Revision } from "../models/revision.model.js";

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
const revisionIds = [1, 2, 3, 4].map((number) => new Types.ObjectId(`20000000000000000000000${number}`));
const cleanupProjectIds = [...projectIds];
const commands: string[] = [];
let server: Server;
let baseUrl: string;

async function cleanupFixtures() {
  await Revision.deleteMany({ _id: { $in: revisionIds } });
  await Project.deleteMany({ _id: { $in: cleanupProjectIds } });
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.MONGODB_URI = testUri;
  process.env.ACCESS_TOKEN_SECRET = secret;
  process.env.INTERNAL_SERVICE_TOKEN = "slice-one-internal-test-token";
  process.env.AI_ORCHESTRATOR_URL = "http://127.0.0.1:9";
  await mongoose.connect(testUri, { serverSelectionTimeoutMS: 5_000, monitorCommands: true });
  await Promise.all([Project.init(), Revision.init()]);
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
    projectId: index === 3 ? projectIds[3]! : projectIds[0]!,
    generationId: new Types.ObjectId(`30000000000000000000000${index + 1}`),
    version: index === 3 ? 50 : index + 1,
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
  const noRevision = await get(`/${projectIds[1]}`);
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
