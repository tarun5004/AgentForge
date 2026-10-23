import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer, type Server } from "node:http";
import { createApp } from "../src/app/app.js";
import { createProjectClient } from "../src/features/runs/project.client.js";
import { createRunService, type RunService } from "../src/features/runs/run.service.js";
import { dockerCommand, DockerCommandError } from "../src/features/runs/docker.command.js";
import { createDockerRunner } from "../src/features/runs/docker.runner.js";
import { createPreviewServer } from "../src/features/runs/preview.server.js";

// Real HTTP listeners use isolated ports instead of the user's running app ports.
async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

// Tear down only test listeners, including their keepalive connections.
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}

// Reuse the repo's optional CLI convention, without adding a runtime browser dependency.
async function verifyBrowser(url: string) {
  const cli = process.env.AGENTFORGE_PLAYWRIGHT_CLI;
  assert.ok(cli, "AGENTFORGE_PLAYWRIGHT_CLI must identify the installed Playwright CLI entry.");
  const execute = promisify(execFile);
  const channel = process.env.AGENTFORGE_BROWSER_CHANNEL ?? "chrome";
  assert.ok(["chrome", "msedge", "firefox", "webkit"].includes(channel));
  const session = `execution-${randomUUID().slice(0, 8)}`;
  // Fail on CLI-reported assertion errors even when its process exits successfully.
  async function browser(...args: string[]) {
    const output = await execute(process.execPath, [cli!, `-s=${session}`, ...args], { windowsHide: true, timeout: 30_000 });
    assert.doesNotMatch(output.stdout + output.stderr, /### Error/);
  }
  try {
    await browser("open", url, `--browser=${channel}`);
    await browser("snapshot");
    await browser("run-code", `--filename=${resolve("tests/preview.browser.js")}`);
    await browser("screenshot", `--filename=${resolve("../output/playwright/execution-preview-css.png")}`);
  } finally {
    // A successful page check must not hide a leaked browser session during teardown.
    await browser("close");
  }
}

// Opt-in real Docker proof: no model call, no normal application database, no host source mount.
test("real Next.js export, isolation probes, invalid build, cancellation and exact cleanup", { timeout: 240_000 }, async () => {
  assert.equal(process.env.RUN_DOCKER_TESTS, "1", "Set RUN_DOCKER_TESTS=1 explicitly; build the trusted runner image first.");
  const runner = await createDockerRunner(process.env.PREVIEW_RUNNER_IMAGE ?? "agentforge-preview-runner:local");
  const revision = { id: "66d987654321abcdef123456", projectId: "66d123456789abcdef123456", files: [{
    path: "app/page.tsx", content: `import {writeFileSync} from 'node:fs';
import Counter from '../components/Counter';
export default async function Page() {
  let readonly = false; let offline = false;
  try { writeFileSync('/app/probe.txt', 'must fail'); } catch { readonly = true; }
  try { await fetch('http://192.0.2.1', {signal: AbortSignal.timeout(500)}); } catch { offline = true; }
  const noSecret = !process.env.AI_GATEWAY_API_KEY && !process.env.JWT_SECRET;
  return <main><h1>AgentForge real Docker preview</h1><p>{'readonly:' + readonly + ',offline:' + offline + ',noSecret:' + noSecret}</p><Counter /></main>;
}`,
  }, { path: "components/Counter.tsx", content: `'use client';
import {useState} from 'react';
export default function Counter() { const [count,setCount] = useState(0); return <button onClick={() => setCount(count+1)}>Count {count}</button>; }`,
  }, { path: "app/globals.css", content: "body { background-color: rgb(12, 34, 56); color: rgb(240, 241, 242); }" }] };
  const projectApi = createServer((req, res) => {
    // Only this HTTP ownership boundary is a fixture; execution and preview are real.
    if (req.headers.authorization !== "Bearer fixture-owner") { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", "application/json");
    res.end(req.url?.includes("/revisions/") ? JSON.stringify({ revision }) : JSON.stringify({ project: { id: revision.projectId } }));
  });
  const projectUrl = await listen(projectApi);
  let service: RunService;
  const preview = createPreviewServer({ artifact: (...args) => service.artifact(...args) });
  const previewOrigin = await listen(preview);
  let diagnostic: unknown;
  service = createRunService({ build: async (input) => {
    try { return await runner.build(input); }
    catch (error) { diagnostic = error; throw error; }
  } }, previewOrigin);
  const api = createServer(createApp({ service, projects: createProjectClient(projectUrl) }));
  const apiOrigin = await listen(api);
  const headers = { authorization: "Bearer fixture-owner", "content-type": "application/json" };
  try {
    const response = await fetch(`${apiOrigin}/api/runs`, { method: "POST", headers,
      body: JSON.stringify({ projectId: revision.projectId, revisionId: revision.id }) });
    assert.equal(response.status, 202);
    const accepted = await response.json() as { run: { id: string } };
    await service.find(accepted.run.id).task;
    const status = await fetch(`${apiOrigin}/api/runs/${accepted.run.id}`, { headers });
    const { run } = await status.json() as { run: { state: string; previewUrl: string } };
    assert.equal(run.state, "ready", diagnostic instanceof DockerCommandError ? diagnostic.diagnostic : String(diagnostic));
    const html = await (await fetch(run.previewUrl)).text();
    assert.match(html, /AgentForge real Docker preview/);
    assert.match(html, /readonly:true,offline:true,noSecret:true/);
    // A build can succeed while silently dropping unimported CSS; verify the actual asset chain.
    const stylesheet = (html.match(/<link\b[^>]*>/g) ?? []).find(tag => /rel="stylesheet"/.test(tag));
    assert.ok(stylesheet, "Saved globals.css must be linked from the exported HTML.");
    const href = stylesheet.match(/href="([^"]+)"/)?.[1];
    assert.ok(href, "Stylesheet link must identify an exported asset.");
    const cssUrl = new URL(href, run.previewUrl);
    assert.equal(cssUrl.origin, new URL(run.previewUrl).origin);
    assert.ok(cssUrl.pathname.startsWith(new URL(run.previewUrl).pathname));
    const css = await fetch(cssUrl);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type")!, /text\/css/);
    assert.match(await css.text(), /background-color:/);
    assert.equal((await dockerCommand(["ps", "-aq", "--filter", `name=agentforge-preview-${accepted.run.id}`])).trim(), "");
    if (process.env.VERIFY_PREVIEW_BROWSER === "1") await verifyBrowser(run.previewUrl);
  } finally {
    await service.close();
    await Promise.all([close(api), close(preview), close(projectApi)]);
  }
  const badId = randomUUID();
  await assert.rejects(runner.build({ id: badId, previewPath: `/preview/${badId}/${"b".repeat(48)}`,
    revision: { ...revision, files: [{ path: "app/page.tsx", content: "export default function Page( { invalid syntax !!!" }] }, signal: new AbortController().signal }));
  assert.equal((await dockerCommand(["ps", "-aq", "--filter", `name=agentforge-preview-${badId}`])).trim(), "");
  const cancelId = randomUUID();
  const abort = new AbortController();
  const cancelled = runner.build({ id: cancelId, previewPath: `/preview/${cancelId}/${"c".repeat(48)}`, revision, signal: abort.signal });
  const outcome = cancelled.then(() => "ready", () => "cancelled");
  const timer = setTimeout(() => abort.abort(), 25_000);
  let buildStarted = false;
  try {
    // Wait for actual Next build output, not merely an in-flight docker create request.
    while (!abort.signal.aborted && !buildStarted) {
      try {
        await dockerCommand(["exec", `agentforge-preview-${cancelId}`, "/usr/bin/test", "-d", "/work/.next"], { timeoutMs: 3_000 });
        buildStarted = true;
      } catch { await delay(200); }
    }
    abort.abort();
    assert.equal(await outcome, "cancelled");
    assert.ok(buildStarted, "Cancellation must interrupt a real Next.js build.");
  } finally { clearTimeout(timer); abort.abort(); await outcome; }
  assert.equal((await dockerCommand(["ps", "-aq", "--filter", `name=agentforge-preview-${cancelId}`])).trim(), "");
});
