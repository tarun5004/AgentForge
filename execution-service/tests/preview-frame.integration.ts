import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { createPreviewServer } from "../src/features/runs/preview.server.js";

// Random owned ports keep this browser-policy test separate from every running application.
async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

// Always release only listeners created by this test, including idle keepalive clients.
async function close(server: Server) {
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((done) => server.close(() => done()));
}

// Real browser enforcement matters: a correct-looking CSP string alone cannot prove embedding works.
test("configured parent embeds an interactive sandbox; a different parent is blocked", { timeout: 90_000 }, async () => {
  assert.equal(process.env.RUN_PREVIEW_BROWSER_TESTS, "1", "Set RUN_PREVIEW_BROWSER_TESTS=1 explicitly.");
  const cli = process.env.AGENTFORGE_PLAYWRIGHT_CLI;
  assert.ok(cli, "Set AGENTFORGE_PLAYWRIGHT_CLI to the installed CLI entry.");
  const channel = process.env.AGENTFORGE_BROWSER_CHANNEL ?? "chrome";
  assert.ok(["chrome", "msedge", "firefox", "webkit"].includes(channel));
  let previewUrl = "";
  let otherOrigin = "";
  const parent = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(`<a href="${otherOrigin}">Other parent</a><iframe title="Local preview" sandbox="allow-scripts" referrerpolicy="no-referrer" src="${previewUrl}"></iframe>`);
  });
  const other = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(`<h1>Other parent</h1><iframe title="Local preview" sandbox="allow-scripts" src="${previewUrl}"></iframe>`);
  });
  const execute = promisify(execFile);
  const session = `preview-frame-${randomUUID().slice(0, 8)}`;
  let preview: Server | undefined;
  let opened = false;
  // CLI assertion errors can appear in stdout even with a zero process exit status.
  async function browser(...args: string[]) {
    const result = await execute(process.execPath, [cli!, `-s=${session}`, ...args], { windowsHide: true, timeout: 30_000 });
    assert.doesNotMatch(result.stdout + result.stderr, /### Error/);
  }
  try {
    const parentOrigin = await listen(parent);
    otherOrigin = await listen(other);
    const html = Buffer.from('<h1>Frame policy fixture</h1><button onclick="this.textContent=\'Clicked\'">Click me</button>');
    preview = createPreviewServer({ artifact: () => html }, parentOrigin);
    previewUrl = `${await listen(preview)}/preview/${randomUUID()}/${"a".repeat(48)}/`;
    opened = true;
    await browser("open", parentOrigin, `--browser=${channel}`);
    await browser("snapshot");
    await browser("run-code", `--filename=${resolve("tests/preview-frame.browser.js")}`);
  } finally {
    try { if (opened) await browser("close"); }
    finally { await Promise.all([close(parent), close(other), ...(preview ? [close(preview)] : [])]); }
  }
});
