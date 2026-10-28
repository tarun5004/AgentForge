import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, test } from "node:test";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";

process.env.AI_PROVIDER = "gateway";
process.env.AI_GATEWAY_API_KEY = "repair-test-not-a-real-key";
process.env.AI_MODEL = "google/gemini-2.5-flash";
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "";
process.env.INTERNAL_SERVICE_TOKEN = "repair-test-internal";
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== "127.0.0.1") throw new Error("Repair tests refuse external network calls.");
  return realFetch(input, init);
};
after(() => { globalThis.fetch = realFetch; });
const { repairProject, repairRequestSchema } = await import("./repair.service.js");
const { createApp } = await import("../../app.js");
const input = {
  requestId: "repair-test-1", projectId: "66d123456789abcdef123456", prompt: "Build a small portfolio page",
  failedFiles: [{ path: "app/page.tsx", content: "export default function Page() { return <h1>{missing}</h1> }" }],
  diagnostics: [{ path: "app/page.tsx", line: 1, column: 48, category: "typescript" as const, code: "TS2304" }],
};
const manifest = { summary: "Fixed the unresolved name in the portfolio page.",
  files: [{ path: "app/page.tsx", content: "export default function Page() { return <h1>Portfolio</h1> }" }], deletedPaths: [] };

// Exercise the installed SDK, but never contact a provider or imply real model quality.
function modelFor(output: unknown = manifest) {
  return new MockLanguageModelV4({ doGenerate: {
    content: [{ type: "text", text: JSON.stringify(output) }], finishReason: { unified: "stop", raw: undefined }, warnings: [],
    usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 20, text: 20, reasoning: undefined } },
  } });
}

test("repair uses exactly one tool-free bounded call and revalidates the changed manifest", async () => {
  const model = modelFor();
  const result = await repairProject(input, model);
  assert.equal(model.doGenerateCalls.length, 1);
  const call = model.doGenerateCalls[0]!;
  assert.equal(call.maxOutputTokens, 8000);
  assert.ok(call.abortSignal);
  assert.equal((call.tools ?? []).length, 0);
  const prompt = JSON.stringify(call.prompt);
  assert.match(prompt, /small name component stays small/);
  assert.match(prompt, /untrusted data/);
  assert.match(prompt, /TS2304/);
  assert.match(prompt, /missing/);
  assert.doesNotMatch(prompt, /First call loadSkill/);
  assert.deepEqual(result.files, manifest.files);
  assert.equal(result.validation.status, "manifest_validated");
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 20, totalTokens: 30 });
});

test("repair does not automatically retry a retryable provider failure", async () => {
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    throw new APICallError({ message: "PRIVATE_PROVIDER", url: "https://invalid.test", requestBodyValues: {}, statusCode: 503 });
  } });
  await assert.rejects(repairProject(input, model));
  assert.equal(model.doGenerateCalls.length, 1);
});

test("unsafe files, raw diagnostic messages, unknown locations and oversized context fail before inference", async () => {
  for (const change of [
    { ownerId: "foreign" },
    { diagnostics: [{ ...input.diagnostics[0], message: "PRIVATE_LOG" }] },
    { diagnostics: [{ ...input.diagnostics[0], path: "/host/file.ts" }] },
    { diagnostics: [{ ...input.diagnostics[0], path: null }] },
    { diagnostics: [{ ...input.diagnostics[0], code: "PRIVATE" }] },
    { diagnostics: Array.from({ length: 9 }, () => input.diagnostics[0]) },
    { failedFiles: [{ path: "app/api/route.ts", content: "export function GET() {}" }] },
    { failedFiles: [{ path: "app/page.tsx", content: "\u0000".repeat(30_000) }, { path: "app/layout.tsx", content: "\u0000".repeat(30_000) }] },
  ]) {
    const model = modelFor();
    await assert.rejects(repairProject({ ...input, ...change } as never, model));
    assert.equal(model.doGenerateCalls.length, 0);
  }
  assert.ok(repairRequestSchema.safeParse({ ...input, diagnostics: [{ path: null, line: null, column: null, category: "compile", code: null }] }).success);
});

test("one repair cannot return unsafe paths, empty snapshots or a no-op", async () => {
  for (const output of [
    { ...manifest, files: [{ path: "app/api/route.ts", content: "export function GET() {}" }] },
    { ...manifest, files: [], deletedPaths: ["app/page.tsx"] },
    { ...manifest, files: input.failedFiles },
  ]) {
    const model = modelFor(output);
    await assert.rejects(repairProject(input, model));
    assert.equal(model.doGenerateCalls.length, 1);
  }
});

test("repair HTTP route requires internal identity, validates input and hides upstream errors", async (t) => {
  let calls = 0; let fail = false;
  const app = createApp(undefined, undefined, undefined, async (request) => {
    calls++;
    if (fail) throw new Error("PRIVATE_PROVIDER_SECRET");
    return repairProject(request, modelFor());
  });
  const server = createServer(app); server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const send = (body: unknown, authenticated = true) => fetch(`http://127.0.0.1:${address.port}/internal/repairs`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { "x-internal-service-token": "repair-test-internal" } : {}) },
    body: JSON.stringify(body),
  });
  assert.equal((await send(input, false)).status, 401);
  assert.equal((await send({ ...input, diagnostics: [{ message: "PRIVATE" }] })).status, 400);
  assert.equal(calls, 0);
  const response = await send(input); assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).generation.files, manifest.files);
  fail = true; const failure = await send(input);
  assert.equal(failure.status, 502);
  assert.doesNotMatch(await failure.text(), /PRIVATE_PROVIDER_SECRET|stack/);
});
