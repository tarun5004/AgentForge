import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { prepareGenerationRequest, validateGenerationResponse } from "./generation.contract.js";

const initial = { requestId: "request-1", projectId: "66d123456789abcdef123456", prompt: "Build a clean developer portfolio page" };
const files = [{ path: "app/page.tsx", content: "export default function Page() {}" }, { path: "app/globals.css", content: "body { color: black; }" }];
const baseRevision = { id: "abcdef1234567890abcdef12", version: 1, files };
const response = {
  generation: {
    requestId: initial.requestId, provider: "test-fixture", model: "fixture-model",
    summary: "Created a compact portfolio page", files,
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, latencyMs: 5,
  },
};

test("prepares bounded initial and selected-base requests with fixed template and mode", () => {
  assert.deepEqual(prepareGenerationRequest(initial), { ...initial, template: "nextjs", mode: "economy" });
  const request = prepareGenerationRequest({ ...initial, baseRevision });
  assert.deepEqual(request.baseRevision, baseRevision);
  assert.throws(() => prepareGenerationRequest({ ...initial, ownerId: "browser-input" }));
  assert.throws(() => prepareGenerationRequest({ ...initial, baseRevision: { ...baseRevision, files: [] } }));
  assert.throws(() => prepareGenerationRequest({ ...initial, baseRevision: { ...baseRevision, version: 0 } }));
  assert.throws(() => prepareGenerationRequest({ ...initial, baseRevision: { ...baseRevision, files: [{ path: "app/api/route.ts", content: "legacy unsafe" }] } }));
});

test("measures serialized UTF-8 context including escaping before the network call", () => {
  for (const character of ["\u0000", "界", '"']) {
    const oversized = { ...baseRevision, files: Array.from({ length: 4 }, (_, i) => ({ path: `lib/f${i}.ts`, content: character.repeat(30_000) })) };
    assert.throws(() => prepareGenerationRequest({ ...initial, baseRevision: oversized }), { statusCode: 413, code: "CONTEXT_TOO_LARGE" });
  }
});

test("legacy initial output defaults to no deletions without fabricated validation metadata", () => {
  const result = validateGenerationResponse(response, initial);
  assert.deepEqual(result.deletedPaths, []);
  assert.equal(result.validation, undefined);
  assert.deepEqual(result.snapshot.fileChanges, [{ path: "app/globals.css", status: "A" }, { path: "app/page.tsx", status: "A" }]);
});

test("follow-up output is upserts internally but the local snapshot preserves omitted files", () => {
  const result = validateGenerationResponse({ generation: {
    ...response.generation, files: [{ path: "app/page.tsx", content: "changed page" }], deletedPaths: [],
    validation: { policyVersion: "frontend-manifest-v1", status: "manifest_validated" },
  } }, { ...initial, baseRevision });
  assert.equal(result.files.length, 1);
  assert.equal(result.snapshot.files.length, 2);
  assert.equal(result.snapshot.files[0]?.content, files[1]?.content);
  assert.deepEqual(result.snapshot.fileChanges, [{ path: "app/page.tsx", status: "M" }]);
});

test("accepts deletion-only output and rejects uncorrelated or unsafe responses safely", () => {
  const result = validateGenerationResponse({ generation: { ...response.generation, files: [], deletedPaths: ["app/globals.css"] } }, { ...initial, baseRevision });
  assert.deepEqual(result.snapshot.files, [files[0]!]);
  for (const generation of [
    { ...response.generation, requestId: "another-request" },
    { ...response.generation, files: [] },
    { ...response.generation, files: [{ path: "lib/secret.ts", content: "sensitive content" }] },
    { ...response.generation, deletedPaths: ["app/globals.css"] },
    { ...response.generation, validation: { policyVersion: "frontend-manifest-v1", status: "build_passed" } },
    { ...response.generation, usage: { inputTokens: -1, outputTokens: 2, totalTokens: 1 } },
  ]) {
    assert.throws(() => validateGenerationResponse({ generation }, initial), {
      statusCode: 502, code: "AI_OUTPUT_INVALID", message: "AI Orchestrator returned invalid generation output.",
    });
  }
});

test("real HTTP client forwards only selected context and validates its reply without a provider", async () => {
  const received: unknown[] = [];
  let reply = response;
  const server = createServer((request, res) => {
    assert.equal(request.url, "/internal/generations");
    assert.equal(request.headers["x-internal-service-token"], "slice-three-fixture-token");
    assert.equal(request.headers["x-request-id"], initial.requestId);
    let body = "";
    request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    request.on("end", () => {
      received.push(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(reply));
    });
  }).listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    // Fake config only: this test never connects to MongoDB or loads a real provider key.
    process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/agentforge_test_unused_contract";
    process.env.ACCESS_TOKEN_SECRET = "slice-three-contract-fixture-secret";
    process.env.INTERNAL_SERVICE_TOKEN = "slice-three-fixture-token";
    process.env.AI_ORCHESTRATOR_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { requestProjectGeneration } = await import("./ai-orchestrator.client.js");
    reply = { generation: { ...response.generation, files: [{ path: "app/page.tsx", content: "changed page" }] } };
    const result = await requestProjectGeneration({ ...initial, baseRevision });
    assert.deepEqual(received[0], prepareGenerationRequest({ ...initial, baseRevision }));
    assert.equal(result.snapshot.files.length, 2);
    reply = { generation: { ...response.generation, requestId: "wrong-id" } };
    await assert.rejects(() => requestProjectGeneration(initial), { code: "AI_OUTPUT_INVALID" });
    const oversized = { ...baseRevision, files: Array.from({ length: 4 }, (_, i) => ({ path: `lib/f${i}.ts`, content: "界".repeat(30_000) })) };
    await assert.rejects(() => requestProjectGeneration({ ...initial, baseRevision: oversized }), { statusCode: 413 });
    assert.equal(received.length, 2, "oversized context must not reach fetch");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
