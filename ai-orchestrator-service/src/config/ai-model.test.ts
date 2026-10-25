import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readAISettings } from "./ai-settings.js";

// Local .env files must not select credentials or models for these zero-spend tests.
process.env.AI_PROVIDER = "google";
process.env.AI_MODEL = "gemini-3.8-flash";
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "google-test-key-not-real";
process.env.AI_GATEWAY_API_KEY = "gateway-test-key-not-real";
process.env.VERCEL_OIDC_TOKEN = "";
process.env.INTERNAL_SERVICE_TOKEN = "internal-test-not-real";
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Provider tests refuse outbound network access."); };
after(() => { globalThis.fetch = originalFetch; });

const { createAIModel } = await import("./ai-model.js");
const { assessRequirements } = await import("../features/requirements/requirement.service.js");
const { generateProject } = await import("../features/generations/generation.service.js");

test("legacy Gateway selection and OIDC remain supported; Google needs only its own key", () => {
  assert.equal(readAISettings({ AI_GATEWAY_API_KEY: "fake" }).AI_MODEL, "google/gemini-2.5-flash");
  assert.equal(readAISettings({ VERCEL_OIDC_TOKEN: "fake" }).AI_PROVIDER, "gateway");
  const direct = readAISettings({ AI_PROVIDER: "google", GOOGLE_GENERATIVE_AI_API_KEY: " fake " });
  assert.equal(direct.AI_MODEL, "gemini-3.5-flash-lite");
  assert.equal(direct.GOOGLE_GENERATIVE_AI_API_KEY, "fake");
  assert.equal(readAISettings({ AI_PROVIDER: "google", GOOGLE_GENERATIVE_AI_API_KEY: "fake", AI_MODEL: "gemini-2.5-flash" }).AI_MODEL, "gemini-2.5-flash");
  const model = createAIModel(readAISettings({ AI_GATEWAY_API_KEY: "fake" }));
  assert.equal(typeof model, "object");
  if (typeof model !== "string") assert.equal(model.modelId, "google/gemini-2.5-flash");
});

test("invalid selection, missing selected credentials and incompatible model IDs fail without leaking secrets", () => {
  for (const source of [
    {}, { AI_PROVIDER: "other", AI_GATEWAY_API_KEY: "secret-marker" },
    { AI_PROVIDER: "google", AI_GATEWAY_API_KEY: "secret-marker" },
    { AI_PROVIDER: "gateway", GOOGLE_GENERATIVE_AI_API_KEY: "secret-marker" },
    { AI_PROVIDER: "google", GOOGLE_GENERATIVE_AI_API_KEY: "fake", AI_MODEL: "google/gemini-3.8-flash" },
    { AI_PROVIDER: "gateway", AI_GATEWAY_API_KEY: "fake", AI_MODEL: "gemini-3.8-flash" },
  ]) {
    assert.throws(() => readAISettings(source), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /secret-marker/);
      return true;
    });
  }
});

// Exercise Google's actual adapter and SDK with intercepted HTTP, never a production fake mode.
function googleFixture(parts: unknown[][], status = 200) {
  type GoogleBody = {
    generationConfig?: { responseMimeType?: string; responseJsonSchema?: unknown };
    toolConfig?: { functionCallingConfig?: { allowedFunctionNames?: string[] } };
    tools?: unknown[];
    contents?: unknown[];
  };
  const requests: { url: string; headers: Headers; body: GoogleBody }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    assert.equal(requests.length <= parts.length, true, "No extra adapter retries or requests");
    // Real Google rejects forced function calls combined with JSON response mode (live HTTP 400).
    const sent = requests[requests.length - 1]!.body;
    if (sent.toolConfig?.functionCallingConfig?.allowedFunctionNames?.length && sent.generationConfig?.responseMimeType === "application/json") {
      return Response.json({ error: { code: 400, status: "INVALID_ARGUMENT", message: "Forced function calling with JSON mode is unsupported" } }, { status: 400 });
    }
    if (status !== 200) return Response.json({ error: { code: status, message: "private-provider-error", status: "RESOURCE_EXHAUSTED" } }, { status });
    return Response.json({
      candidates: [{ content: { role: "model", parts: parts[requests.length - 1] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
    });
  };
  const model = createAIModel(readAISettings(process.env), fetcher);
  return { model, requests };
}

const request = { requestId: "direct-google-test", projectId: "66d123456789abcdef123456", prompt: "Build a small Tarun Raj name component" };
const manifest = {
  summary: "Created a small accessible name component.",
  files: [{ path: "app/page.tsx", content: "export default function Page() { return <h1>Tarun Raj</h1>; }" }], deletedPaths: [],
};

test("requirements use the real Google JSON adapter with no Gateway auth or network", async () => {
  const assessment = { status: "ready", message: "Ready to generate.", brief: request.prompt, questions: [] };
  const fixture = googleFixture([[{ text: JSON.stringify(assessment) }]]);
  const result = await assessRequirements({ ...request, answers: [] }, fixture.model);
  assert.equal(result.status, "ready");
  assert.equal(fixture.requests.length, 1);
  const sent = fixture.requests[0]!;
  assert.equal(sent.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(sent.headers.get("x-goog-api-key"), "google-test-key-not-real");
  assert.equal(sent.headers.has("authorization"), false);
  assert.equal(sent.body.generationConfig?.responseMimeType, "application/json");
  assert.ok(sent.body.generationConfig?.responseJsonSchema);
});

test("Google generation calls the local skill then returns validated files with summed usage", async () => {
  const fixture = googleFixture([
    [{ functionCall: { name: "loadSkill", args: { skillId: "frontend-design" } }, thoughtSignature: "test-signature" }],
    [{ text: JSON.stringify(manifest) }],
  ]);
  const result = await generateProject({ ...request, template: "nextjs", mode: "economy" }, fixture.model);
  assert.equal(fixture.requests.length, 2);
  assert.equal(result.provider, "google");
  assert.equal(result.model, "gemini-3.8-flash");
  assert.deepEqual(result.files, manifest.files);
  assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 40, totalTokens: 60 });
  const first = fixture.requests[0]!.body;
  assert.deepEqual(first.toolConfig?.functionCallingConfig?.allowedFunctionNames, ["loadSkill"]);
  assert.equal(first.generationConfig?.responseMimeType, undefined, "The forced tool step must not enable JSON response mode");
  const second = fixture.requests[1]!.body;
  assert.ok(JSON.stringify(second.contents).includes("small name component stays small"));
  assert.ok(JSON.stringify(second.contents).includes("test-signature"));
  assert.equal(second.generationConfig?.responseMimeType, "application/json");
  assert.equal((second.tools ?? []).length, 0);
});

test("Google quota failure is not retried or routed to paid Gateway", async () => {
  const fixture = googleFixture([[]], 429);
  await assert.rejects(assessRequirements({ ...request, answers: [] }, fixture.model));
  assert.equal(fixture.requests.length, 1);
});

test("Google output still passes independent frontend safety validation", async () => {
  const fixture = googleFixture([
    [{ functionCall: { name: "loadSkill", args: { skillId: "frontend-design" } }, thoughtSignature: "test-signature" }],
    [{ text: JSON.stringify({ ...manifest, files: [{ path: "app/api/route.ts", content: "export function GET() {}" }] }) }],
  ]);
  await assert.rejects(generateProject({ ...request, template: "nextjs", mode: "economy" }, fixture.model), /Unsafe generated frontend file path/);
  assert.equal(fixture.requests.length, 2);
});
