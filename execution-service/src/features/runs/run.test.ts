import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, get, type Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../../app/app.js";
import { createProjectClient } from "./project.client.js";
import { createRunService } from "./run.service.js";
import { createPreviewServer } from "./preview.server.js";
import { buildContainerArgs, createDockerRunner } from "./docker.runner.js";
import { parseArtifacts } from "./run.artifacts.js";
import { createRunBodySchema, validateRevision } from "./run.schema.js";
import { RunCleanupError } from "./run.errors.js";
import { stopExecution } from "../../shutdown.js";
import { randomUUID } from "node:crypto";

const projectId = "66d123456789abcdef123456";
const revisionId = "66d987654321abcdef123456";
const revision = { projectId, id: revisionId, files: [{ path: "app/page.tsx", content: "export default function Page() { return <h1>Hello</h1> }" }] };
const artifactJson = JSON.stringify([{ path: "index.html", content: Buffer.from("<h1>Fixture</h1>").toString("base64") }]);

// Real local HTTP exercises routing without touching user records or a model provider.
async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

// Close keepalive connections so failed assertions cannot leave the test runner hanging.
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test("request accepts IDs only and rejects malformed IDs/commands/owners", () => {
  assert.deepEqual(createRunBodySchema.parse({ projectId, revisionId }), { projectId, revisionId });
  for (const extra of [{ command: "whoami" }, { files: [] }, { image: "evil" }, { ownerId: projectId }]) {
    assert.equal(createRunBodySchema.safeParse({ projectId, revisionId, ...extra }).success, false);
  }
  assert.equal(createRunBodySchema.safeParse({ projectId: "no", revisionId }).success, false);
});

test("stored frontend files are bounded and independently revalidated", () => {
  assert.equal(validateRevision(revision).id, revisionId);
  for (const path of ["../page.tsx", "app/../page.tsx", "app//page.tsx", "app/api/route.ts", "app/secret.ts", "app/.env.ts", "app/route.ts", "next.config.ts"]) {
    assert.throws(() => validateRevision({ ...revision, files: [...revision.files, { path, content: "unsafe" }] }));
  }
  assert.throws(() => validateRevision({ ...revision, files: [...revision.files, { path: "app/PAGE.tsx", content: "duplicate" }] }));
  assert.throws(() => validateRevision({ ...revision, files: [{ path: "app/page.tsx", content: '"use server";' }] }));
  assert.throws(() => validateRevision({ ...revision, files: [{ path: "components/Foo.tsx", content: "no homepage" }] }));
  assert.throws(() => validateRevision({ ...revision, files: [{ path: "app/page.tsx", content: "x".repeat(30_001) }] }));
  assert.throws(() => validateRevision({ ...revision, files: [{ path: "app/Page.tsx", content: "wrong case on Linux" }] }));
});

test("artifact parser rejects traversal, duplicates, invalid base64 and oversized output", () => {
  assert.equal(parseArtifacts(artifactJson).get("index.html")?.toString(), "<h1>Fixture</h1>");
  assert.equal(parseArtifacts(JSON.stringify([{ path: "index.html", content: Buffer.alloc(500_000).toString("base64") }])).get("index.html")?.length, 500_000);
  for (const path of ["../index.html", "/index.html", "a//index.html", "index.svg", "index.html.exe"]) {
    assert.throws(() => parseArtifacts(JSON.stringify([{ path, content: "eA==" }])));
  }
  assert.throws(() => parseArtifacts(JSON.stringify([{ path: "index.html", content: "!" }])));
  assert.throws(() => parseArtifacts(JSON.stringify([{ path: "index.html", content: "eA==" }, { path: "index.html", content: "eA==" }])));
  assert.throws(() => parseArtifacts(JSON.stringify([{ path: "index.html", content: Buffer.alloc(6 * 1024 * 1024 + 1).toString("base64") }])));
});

test("container policy contains isolation limits and no host mounts or exposed ports", () => {
  const args = buildContainerArgs("fixed-name", "sha256:fixture");
  for (const flag of ["--read-only", "--network", "none", "--cap-drop", "ALL", "--pids-limit", "--memory", "--cpus", "--user", "1000:1000", "no-new-privileges=true"]) assert.ok(args.includes(flag));
  for (const flag of ["--privileged", "-v", "--volume", "--mount", "-p", "--publish", "--env-file"]) assert.equal(args.includes(flag), false);
});

test("duplicate admission reuses one run; cancellation holds the slot until cleanup finishes", async () => {
  let finish!: () => void;
  let calls = 0;
  const service = createRunService({ build: async () => {
    calls++;
    await new Promise<void>((resolve) => { finish = resolve; });
    return parseArtifacts(artifactJson);
  } }, "http://127.0.0.1:5101");
  try {
    const first = service.start(revision);
    assert.equal(service.start(revision).id, first.id);
    assert.equal(calls, 1);
    assert.equal(service.cancel(service.find(first.id)).state, "cancelling");
    assert.throws(() => service.start({ ...revision, id: "66d987654321abcdef123457" }), /already running/);
    finish();
    await service.find(first.id).task;
    assert.equal(service.describe(service.find(first.id)).state, "cancelled");
    assert.equal(service.describe(service.find(first.id)).previewUrl, null);
  } finally { finish?.(); await service.close(); }
});

test("cancel cannot conceal a failed container cleanup or clear its warning", async () => {
  let rejectBuild!: (error: Error) => void;
  const service = createRunService({ build: () => new Promise((_resolve, reject) => { rejectBuild = reject; }) }, "http://127.0.0.1:5101");
  try {
    const result = service.start(revision);
    const run = service.find(result.id);
    service.cancel(run);
    rejectBuild(new RunCleanupError());
    await run.task;
    assert.equal(service.describe(run).state, "failed");
    assert.equal(service.describe(run).errorCode, "CLEANUP_UNCONFIRMED");
    assert.equal(service.cancel(run).errorCode, "CLEANUP_UNCONFIRMED");
  } finally { await service.close(); }
});

test("runner refuses new work after unconfirmed cleanup and does not create pre-cancelled jobs", async () => {
  const calls: string[] = [];
  const command = async (args: string[]) => {
    calls.push(args[0]!);
    if (args[0] === "info") return '"linux"';
    if (args[0] === "image") return `sha256:${"a".repeat(64)}`;
    if (args[0] === "ps") return "";
    if (args[0] === "inspect") return "true";
    if (args[0] === "rm") throw new Error("fixture cleanup failure");
    if (args.includes("/runner/export.mjs")) return artifactJson;
    return "";
  };
  const runner = await createDockerRunner("fixture:local", command);
  const abort = new AbortController();
  abort.abort();
  const input = { id: randomUUID(), revision, previewPath: "/fixture", signal: abort.signal };
  const before = calls.length;
  await assert.rejects(runner.build(input), /cancelled before admission/);
  assert.equal(calls.length, before);
  await assert.rejects(runner.build({ ...input, signal: new AbortController().signal }), RunCleanupError);
  const afterFailure = calls.length;
  await assert.rejects(runner.build({ ...input, signal: new AbortController().signal }), RunCleanupError);
  assert.equal(calls.length, afterFailure);
});

test("shutdown starts build cleanup before an active HTTP response drains", async () => {
  let completeResponse!: () => void;
  let seenRequest!: () => void;
  const requestArrived = new Promise<void>((resolve) => { seenRequest = resolve; });
  const server = createServer((_req, res) => {
    completeResponse = () => res.end("finished");
    seenRequest();
  });
  const origin = await listen(server);
  const response = fetch(origin);
  await requestArrived;
  let cleanupStarted = false;
  const stopped = stopExecution(server, undefined, async () => { cleanupStarted = true; });
  assert.equal(cleanupStarted, true);
  completeResponse();
  await response;
  await stopped;
});

test("failed builds expose no daemon details or source logs", async () => {
  const service = createRunService({ build: async () => { throw new Error("SECRET_HOST_DETAILS"); } }, "http://127.0.0.1:5101");
  try {
    const run = service.start(revision);
    await service.find(run.id).task;
    const result = service.describe(service.find(run.id));
    assert.equal(result.state, "failed");
    assert.equal(result.previewUrl, null);
    assert.equal(JSON.stringify(result).includes("SECRET_HOST_DETAILS"), false);
  } finally { await service.close(); }
});

test("status/asset polling does not prevent expiry; activity is capped by maximum lifetime", async () => {
  let clock = 1000;
  const service = createRunService({ build: async () => parseArtifacts(artifactJson) }, "http://127.0.0.1:5101", () => clock);
  try {
    const result = service.start(revision);
    const run = service.find(result.id);
    await run.task;
    clock += 29 * 60_000;
    assert.equal(service.describe(run).state, "ready");
    service.touch(run);
    clock += 29 * 60_000;
    assert.equal(service.describe(run).state, "ready");
    service.touch(run);
    clock += 2 * 60_000;
    assert.equal(service.describe(run).state, "expired");
    assert.equal(run.artifacts.size, 0);
    assert.throws(() => service.artifact(run.id, run.token, "index.html"));
    const next = service.start(revision);
    await service.find(next.id).task;
    clock += 30 * 60_000;
    assert.equal(service.describe(service.find(next.id)).state, "expired");
  } finally { await service.close(); }
});

test("preview uses an expiring capability and restrictive separate-origin headers", async () => {
  const service = createRunService({ build: async () => parseArtifacts(artifactJson) }, "http://127.0.0.1:5101");
  const server = createPreviewServer(service);
  const origin = await listen(server);
  try {
    const result = service.start(revision);
    const run = service.find(result.id);
    await run.task;
    const path = `/preview/${run.id}/${run.token}/`;
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "<h1>Fixture</h1>");
    assert.match(response.headers.get("content-security-policy")!, /connect-src 'none'/);
    assert.match(response.headers.get("content-security-policy")!, /sandbox allow-scripts;/);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal((await fetch(origin + path.replace(run.token, "0".repeat(48)))).status, 404);
    assert.equal((await fetch(origin + path, { method: "POST" })).status, 404);
    // Fetch may rewrite Host; use raw HTTP to actually exercise DNS-rebinding protection.
    const badHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(origin + path, { headers: { host: "evil.test" } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on("error", reject);
    });
    assert.equal(badHostStatus, 404);
    service.cancel(run);
    assert.equal((await fetch(origin + path)).status, 404);
  } finally { await close(server); await service.close(); }
});

test("HTTP owner authorization, invalid body, token expiry and disabled mode", async () => {
  let loads = 0;
  let ownerActive = true;
  const upstream = createServer((req, res) => {
    if (req.headers.authorization !== "Bearer owner") { res.writeHead(404).end(); return; }
    if (!ownerActive) { res.writeHead(401).end(); return; }
    loads++;
    res.setHeader("Content-Type", "application/json");
    res.end(req.url?.includes("/revisions/") ? JSON.stringify({ revision }) : JSON.stringify({ project: { id: projectId } }));
  });
  const upstreamUrl = await listen(upstream);
  const service = createRunService({ build: async () => parseArtifacts(artifactJson) }, "http://127.0.0.1:5101");
  const api = createApp({ service, projects: createProjectClient(upstreamUrl) }).listen();
  await once(api, "listening");
  const address = api.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const headers = { authorization: "Bearer owner", "content-type": "application/json" };
  const body = JSON.stringify({ projectId, revisionId });
  try {
    assert.equal((await fetch(origin + "/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body })).status, 401);
    assert.equal(loads, 0);
    assert.equal((await fetch(origin + "/api/runs", { method: "POST", headers, body: JSON.stringify({ projectId, revisionId, command: "x" }) })).status, 400);
    assert.equal(loads, 0);
    assert.equal((await fetch(origin + "/api/runs", { method: "POST", headers: { ...headers, authorization: "Bearer stranger" }, body })).status, 404);
    const response = await fetch(origin + "/api/runs", { method: "POST", headers, body });
    assert.equal(response.status, 202);
    const { run } = await response.json() as { run: { id: string } };
    assert.equal((await fetch(`${origin}/api/runs/${run.id}`, { headers: { authorization: "Bearer stranger" } })).status, 404);
    const ready = await fetch(`${origin}/api/runs/${run.id}`, { headers });
    assert.equal((await ready.json() as { run: { state: string } }).run.state, "ready");
    ownerActive = false;
    assert.equal((await fetch(`${origin}/api/runs/${run.id}`, { headers })).status, 401);
    assert.equal((await fetch(`${origin}/api/runs/${run.id}`, { method: "DELETE", headers })).status, 401);
    ownerActive = true;
    assert.equal((await fetch(`${origin}/api/runs/${run.id}`, { method: "DELETE", headers })).status, 200);
    assert.equal((await fetch(origin + "/api/runs", { method: "POST", headers, body: "{" })).status, 400);
    assert.equal((await fetch(origin + "/api/runs", { method: "POST", headers, body: JSON.stringify({ data: "x".repeat(40_000) }) })).status, 413);
  } finally { await close(api); await close(upstream); await service.close(); }
  const disabled = createApp().listen();
  await once(disabled, "listening");
  const disabledAddress = disabled.address();
  assert.ok(disabledAddress && typeof disabledAddress !== "string");
  try { assert.equal((await fetch(`http://127.0.0.1:${disabledAddress.port}/api/runs`, { method: "POST" })).status, 503); }
  finally { await close(disabled); }
});
