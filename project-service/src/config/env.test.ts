import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// A fresh process and empty directory keep local credentials/dotenv out of configuration tests.
function readConfig(url = "") {
  const directory = mkdtempSync(join(tmpdir(), "agentforge-project-config-"));
  try {
    return spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e",
      `const {env}=await import(${JSON.stringify(new URL("./env.ts", import.meta.url).href)}); process.stdout.write(env.AI_ORCHESTRATOR_URL);`], {
      cwd: directory, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, NODE_ENV: "test", PORT: "3000", BUILD_GATE_ENABLED: "false",
        EXECUTION_CHECK_TOKEN: undefined, DOTENV_CONFIG_QUIET: "true",
        MONGODB_URI: "mongodb://127.0.0.1/agentforge_test_config", ACCESS_TOKEN_SECRET: "config-test-only",
        INTERNAL_SERVICE_TOKEN: "config-internal-test-only", AI_ORCHESTRATOR_URL: url },
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("host AI defaults to a Fetch-compatible port", () => {
  const result = readConfig();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "http://localhost:6001");
});

test("the blocked port fails at startup, while Compose DNS remains supported", () => {
  const blocked = readConfig("http://localhost:6000");
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /port 6000 is blocked by Fetch/);
  const compose = readConfig("http://ai-orchestrator-service:6001");
  assert.equal(compose.status, 0, compose.stderr);
});
