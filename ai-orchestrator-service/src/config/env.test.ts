import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Configuration is checked without loading a developer's .env or calling a model.
function readConfig(port?: string) {
  const directory = mkdtempSync(join(tmpdir(), "agentforge-ai-config-"));
  try {
    return spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e",
      `const {env}=await import(${JSON.stringify(new URL("./env.ts", import.meta.url).href)}); process.stdout.write(String(env.PORT));`], {
      cwd: directory, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, PORT: port, AI_PROVIDER: "gateway", AI_MODEL: "google/gemini-2.5-flash",
        AI_GATEWAY_API_KEY: "config-test-not-a-real-key", INTERNAL_SERVICE_TOKEN: "config-test-only",
        DOTENV_CONFIG_QUIET: "true" },
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("AI defaults to port 6001 without requiring local overrides", () => {
  const result = readConfig();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "6001");
});

test("an old local port setting fails with an actionable message", () => {
  const result = readConfig("6000");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PORT 6000 is blocked by Fetch/);
});
