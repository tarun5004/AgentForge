import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../../app/app.js";
import { candidateHash, checkInputSchema, checkServiceToken, createCandidateChecks, createCandidateClient } from "./candidate.check.js";
import { createDockerRunner } from "./docker.runner.js";
import { DockerCommandError } from "./docker.command.js";
import { RunBuildError, RunCleanupError, RunError } from "./run.errors.js";

const projectId = "100000000000000000000001";
const generationId = "200000000000000000000001";
const token = "candidate-test-service-secret-00001";
const revision = { projectId, id: generationId, files: [{ path: "app/page.tsx", content: "export default function Page() { return <h1>Hello</h1> }" }] };
const input = { projectId, generationId, snapshotHash: candidateHash(revision.files) };
const imageId = `sha256:${"a".repeat(64)}`;

// Ephemeral servers exercise real HTTP without user records, provider requests or Docker.
async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test address.");
  return `http://127.0.0.1:${address.port}`;
}

test("candidate hash is order independent but exact source bytes matter", () => {
  const files = [...revision.files, { path: "app/globals.css", content: "body {}" }];
  assert.equal(candidateHash(files), candidateHash([...files].reverse()));
  assert.notEqual(candidateHash(files), candidateHash(files.map((file) => ({ ...file, content: file.content + "\n" }))));
  assert.equal(checkInputSchema.safeParse({ ...input, files }).success, false);
  assert.equal(checkServiceToken(token, token), true);
  assert.equal(checkServiceToken([token], token), false);
});

test("candidate transport forwards both credentials, checks owner response and rejects changed bytes", async (t) => {
  let mode = "ok";
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, "Bearer owner");
    assert.equal(req.headers["x-execution-check-token"], token);
    assert.equal(req.url, `/internal/projects/${projectId}/generations/${generationId}/candidate`);
    if (mode === "foreign") { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ candidate: { ...input, files: mode === "changed" ? [{ ...revision.files[0], content: "changed" }] : revision.files } }));
  });
  const origin = await listen(server); t.after(() => server.close());
  const load = createCandidateClient(origin, token);
  assert.deepEqual(await load(input, "Bearer owner"), revision);
  mode = "foreign";
  await assert.rejects(load(input, "Bearer owner"), (error: unknown) => error instanceof RunError && error.statusCode === 404);
  mode = "changed";
  await assert.rejects(load(input, "Bearer owner"), (error: unknown) => error instanceof RunError && error.code === "CANDIDATE_INVALID");
});

test("same candidate joins one build and replays proof only after reauthorization", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  let builds = 0; let loads = 0; let denied = false;
  const checks = createCandidateChecks({ imageId, async build() { builds++; await barrier; return new Map(); } }, async () => {
    loads++; if (denied) throw new RunError(404, "NOT_FOUND", "Not found."); return revision;
  });
  const a = checks.check(input, "Bearer owner"); const b = checks.check(input, "Bearer owner");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(builds, 1); release();
  const proof = await a;
  assert.deepEqual(await b, proof); assert.equal(proof.snapshotHash, input.snapshotHash);
  assert.equal(proof.runnerImageId, imageId); assert.equal(proof.status, "build_passed");
  assert.deepEqual(await checks.check(input, "Bearer owner"), proof);
  denied = true; await assert.rejects(checks.check(input, "Bearer foreign"));
  assert.equal(builds, 1); assert.equal(loads, 4); await checks.close();
});

test("an owned hash-matching unsupported snapshot is terminal and never enters Docker", async (t) => {
  const files = [{ path: "components/Only.tsx", content: "export default function Only() { return <h1>No page</h1> }" }];
  const unsupported = { ...input, snapshotHash: candidateHash(files) };
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ candidate: { ...unsupported, files } }));
  });
  const origin = await listen(server); let builds = 0;
  const checks = createCandidateChecks({ imageId, async build() { builds++; return new Map(); } }, createCandidateClient(origin, token));
  t.after(async () => { server.close(); await checks.close(); });
  await assert.rejects(checks.check(unsupported, "Bearer owner"), (error: unknown) => error instanceof RunError && error.statusCode === 422 && error.code === "CANDIDATE_UNSUPPORTED");
  assert.equal(builds, 0);
});

test("compile failure is terminal, but cleanup and busy outcomes never claim a failed source build", async () => {
  for (const [failure, status, code] of [
    [new RunBuildError("compile"), 422, "BUILD_VERIFICATION_FAILED"],
    [new RunCleanupError(), 503, "CLEANUP_UNCONFIRMED"],
    [new RunError(429, "BUILD_BUSY", "Busy."), 429, "BUILD_BUSY"],
    [new RunBuildError("compile", "timeout"), 503, "BUILD_CHECK_UNAVAILABLE"],
  ] as const) {
    let builds = 0;
    const checks = createCandidateChecks({ imageId, async build() { builds++; throw failure; } }, async () => revision);
    for (let i = 0; i < 2; i++) await assert.rejects(checks.check(input, "Bearer owner"), (error: unknown) => error instanceof RunError && error.statusCode === status && error.code === code);
    assert.equal(builds, status === 422 ? 1 : 2); await checks.close();
  }
});

test("internal HTTP requires both credentials and refuses raw source fields", async (t) => {
  let loads = 0;
  const checks = createCandidateChecks({ imageId, async build() { return new Map(); } }, async () => { loads++; return revision; });
  const server = createServer(createApp(undefined, { checks, token }));
  const origin = await listen(server);
  t.after(async () => { server.close(); await checks.close(); });
  const send = (headers: Record<string, string>, body: unknown = input) => fetch(`${origin}/internal/checks`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await send({ authorization: "Bearer owner" })).status, 403);
  assert.equal((await send({ "x-execution-check-token": token })).status, 401);
  const headers = { authorization: "Bearer owner", "x-execution-check-token": token };
  assert.equal((await send(headers, { ...input, files: revision.files })).status, 400);
  const response = await send(headers);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).buildVerification.status, "build_passed"); assert.equal(loads, 1);
});

test("one Docker runner shares admission between preview and candidate consumers", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const runner = await createDockerRunner("fixture", async (args) => {
    if (args[0] === "info") return '"linux"';
    if (args[0] === "image") return imageId;
    if (args[0] === "ps") return "";
    if (args[0] === "inspect") return "true";
    if (args.includes("build")) { await barrier; return ""; }
    if (args.includes("/runner/export.mjs")) return JSON.stringify([{ path: "index.html", content: Buffer.from("ok").toString("base64") }]);
    return "";
  });
  const active = runner.build({ id: "first", revision, previewPath: "/preview/first", signal: new AbortController().signal });
  await assert.rejects(runner.build({ id: "second", revision, previewPath: "/check/second", signal: new AbortController().signal }), (error: unknown) => error instanceof RunError && error.code === "BUILD_BUSY");
  release(); await active;
});

test("internal compile failure returns safe locations through the real runner, never raw logs", async (t) => {
  const calls: string[] = [];
  const runner = await createDockerRunner("fixture", async (args) => {
    calls.push(args[0]!);
    if (args[0] === "info") return '"linux"';
    if (args[0] === "image") return imageId;
    if (args[0] === "ps") return "";
    if (args[0] === "inspect") return "true";
    if (args.includes("build")) throw new DockerCommandError("PRIVATE_MESSAGE", "./app/page.tsx:5:3\nType error: SECRET_VALUE", 1);
    return "";
  });
  const checks = createCandidateChecks(runner, async () => revision);
  const server = createServer(createApp(undefined, { checks, token }));
  const origin = await listen(server);
  t.after(async () => { server.close(); await checks.close(); });
  const response = await fetch(`${origin}/internal/checks`, { method: "POST",
    headers: { "Content-Type": "application/json", authorization: "Bearer owner", "x-execution-check-token": token },
    body: JSON.stringify(input),
  });
  assert.equal(response.status, 422);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.code, "BUILD_VERIFICATION_FAILED");
  assert.deepEqual(body.diagnostics, [{ path: "app/page.tsx", line: 5, column: 3, category: "typescript", code: null }]);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE|SECRET|Bearer|stack/);
  assert.equal(calls.at(-1), "rm");
});
