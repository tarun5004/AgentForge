import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { createApp } from "../../app/app.js";
import { DockerCommandError, type DockerFailureReason } from "./docker.command.js";
import { createDockerRunner } from "./docker.runner.js";
import { RunBuildError, RunCleanupError, type BuildStage } from "./run.errors.js";
import { createRunService } from "./run.service.js";

const revision = { projectId: "66d123456789abcdef123456", id: "66d987654321abcdef123456",
  files: [{ path: "app/page.tsx", content: "export default function Page() { return <h1>Fixture</h1>; }" }] };
const artifacts = JSON.stringify([{ path: "index.html", content: Buffer.from("fixture").toString("base64") }]);
const privateMarker = "PRIVATE_SOURCE_CREDENTIAL_HOST_MARKER";

// Replace Docker transport, keeping the real runner's stage transitions and finally cleanup.
async function failingRunner(stage: BuildStage, reason: DockerFailureReason = "command_failed", cleanupFails = false) {
  const calls: string[] = [];
  const runner = await createDockerRunner("fixture:local", async args => {
    calls.push(args[0]!);
    if (args[0] === "info") return '"linux"';
    if (args[0] === "image") return `sha256:${"a".repeat(64)}`;
    if (args[0] === "ps") return "";
    if (args[0] === "inspect") return "true";
    if (args[0] === "rm") { if (cleanupFails) throw new Error(privateMarker); return ""; }
    const failed = (stage === "container" && args[0] === "start") ||
      (stage === "prepare" && args.includes("/runner/prepare.mjs")) ||
      (stage === "compile" && args.includes("build")) ||
      (stage === "export" && args.includes("/runner/export.mjs"));
    if (failed) throw new DockerCommandError(privateMarker, privateMarker, 1, reason);
    if (args.includes("/runner/export.mjs")) return stage === "artifacts" ? privateMarker : artifacts;
    return "";
  });
  return { runner, calls };
}

for (const stage of ["container", "prepare", "compile", "export", "artifacts"] as const) {
  test(`runner safely classifies ${stage} failure and cleans its container`, async () => {
    const { runner, calls } = await failingRunner(stage);
    await assert.rejects(runner.build({ id: randomUUID(), revision, previewPath: "/fixture", signal: new AbortController().signal }), error => {
      assert.ok(error instanceof RunBuildError);
      assert.equal(error.stage, stage);
      assert.match(error.message, /^Build failed\./);
      assert.ok(error.message.length <= 300);
      assert.doesNotMatch(JSON.stringify(error) + error.message, /PRIVATE_SOURCE/);
      return true;
    });
    assert.equal(calls.at(-1), "rm");
  });
}

test("reason messages distinguish timeout, output cap and unavailable CLI without guessing a syntax error", async () => {
  for (const [reason, text] of [["timeout", /Time limit/], ["output_limit", /Output limit/], ["unavailable", /CLI is unavailable/]] as const) {
    const { runner } = await failingRunner("compile", reason);
    await assert.rejects(runner.build({ id: randomUUID(), revision, previewPath: "/fixture", signal: new AbortController().signal }), error => {
      assert.ok(error instanceof RunBuildError);
      assert.equal(error.reason, reason);
      assert.match(error.message, text);
      assert.doesNotMatch(error.message, /PRIVATE_SOURCE|syntax error/);
      return true;
    });
  }
});

test("cleanup failure overrides a known compile failure and disables later admission", async () => {
  const { runner } = await failingRunner("compile", "timeout", true);
  const input = { id: randomUUID(), revision, previewPath: "/fixture", signal: new AbortController().signal };
  await assert.rejects(runner.build(input), RunCleanupError);
  await assert.rejects(runner.build(input), RunCleanupError);
});

test("a retry after unconfirmed cleanup keeps the operator warning instead of a generic build error", async () => {
  const { runner } = await failingRunner("compile", "timeout", true);
  const service = createRunService(runner, "http://127.0.0.1:5101");
  try {
    const first = service.start(revision);
    await service.find(first.id).task;
    const retry = service.start(revision);
    await service.find(retry.id).task;
    assert.equal(service.describe(service.find(retry.id)).errorCode, "CLEANUP_UNCONFIRMED");
    assert.equal(service.describe(service.find(retry.id)).previewUrl, null);
  } finally { await service.close(); }
});

test("user cancellation remains cancelled rather than a failed compile", async () => {
  let fail!: () => void;
  const service = createRunService({ build: () => new Promise((_resolve, reject) => { fail = () => reject(new RunBuildError("compile", "cancelled")); }) }, "http://127.0.0.1:5101");
  try {
    const started = service.start(revision);
    const run = service.find(started.id);
    service.cancel(run);
    fail();
    await run.task;
    assert.equal(service.describe(run).state, "cancelled");
    assert.equal(service.describe(run).errorCode, null);
  } finally { fail?.(); await service.close(); }
});

test("HTTP status retains the old contract and exposes only the safe stage message", async () => {
  const { runner } = await failingRunner("compile", "timeout");
  const service = createRunService(runner, "http://127.0.0.1:5101");
  const api = createServer(createApp({ service, projects: { loadRevision: async () => revision, authorize: async () => {} } }));
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const address = api.address();
  assert.ok(address && typeof address !== "string");
  try {
    const started = service.start(revision);
    await service.find(started.id).task;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/runs/${started.id}`, { headers: { authorization: "Bearer fixture-owner" } });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.run.state, "failed");
    assert.equal(payload.run.errorCode, "BUILD_FAILED");
    assert.equal(payload.run.previewUrl, null);
    assert.match(payload.run.message, /Time limit exceeded while running the frontend build command/);
    assert.deepEqual(Object.keys(payload.run).sort(), ["id", "projectId", "revisionId", "state", "message", "errorCode", "createdAt", "previewUrl"].sort());
    assert.doesNotMatch(JSON.stringify(payload), /PRIVATE_SOURCE|diagnostic|exitCode|stack|reason/);
  } finally {
    api.closeAllConnections();
    await new Promise<void>(resolve => api.close(() => resolve()));
    await service.close();
  }
});
