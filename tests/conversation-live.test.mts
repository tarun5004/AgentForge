import assert from "node:assert/strict";
import { test } from "node:test";
import { guardLiveProvider, liveModelPricing, parseLiveOptions, validateLiveDatabase } from "../scripts/verify-conversation-live.mts";

// Guards run without dotenv, Mongo, Docker, a browser or any real network request.
test("live verification is credential-free by default and requires both opt-ins", () => {
  assert.equal(parseLiveOptions([]).execute, false);
  assert.equal(parseLiveOptions(["--execute", "--allow-live"]).execute, true);
  for (const flags of [["--execute"], ["--allow-live"], ["--paid"], ["--execute", "--execute"]]) assert.throws(() => parseLiveOptions(flags));
});

test("database guard permits only explicit local dedicated test targets", () => {
  assert.equal(validateLiveDatabase("mongodb://127.0.0.1:27029/agentforge_test_live_26"), "agentforge_test_live_26");
  for (const value of [undefined, "mongodb://localhost/app", "mongodb://remote/agentforge_test_x", "mongodb://u:p@localhost/agentforge_test_x", "mongodb://localhost/agentforge_test_x?authSource=admin", "mongodb://localhost/agentforge_test_x#fragment"]) {
    assert.throws(() => validateLiveDatabase(value));
  }
});

// Each body is unique so the cap test does not accidentally exercise duplicate detection instead.
function input(index: number, outputCap = 100) {
  return { method: "POST", body: JSON.stringify({ generationConfig: { maxOutputTokens: outputCap }, contents: [{ text: `Synthetic prompt ${index}` }] }) };
}

const model = "gemini-3.5-flash-lite";
const origin = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

test("provider guard admits ten requests and blocks the eleventh before network", async () => {
  let requests = 0;
  const calls: { index: number; outputCap: number }[] = [];
  const fetcher = (async () => { requests++; return Response.json({ usageMetadata: { totalTokenCount: 10 } }); }) as typeof fetch;
  const guarded = guardLiveProvider(fetcher, model, calls);
  for (let index = 0; index < 10; index++) await guarded(origin, input(index));
  await assert.rejects(guarded(origin, input(11)));
  assert.equal(requests, 10);
  assert.equal(calls.length, 10);
});

test("wrong provider/model, oversized output, duplicate body and failed response halt inference", async () => {
  for (const [url, options] of [["https://example.com/generate", input(1)], [origin.replace(model, "gemini-other"), input(1)], [origin, input(1, 8001)],
    [origin.replace("https:", "http:"), input(1)], [origin, { method: "POST", body: "not-json" }],
    [origin, { method: "POST", body: JSON.stringify({ generationConfig: { maxOutputTokens: 100 }, text: "é".repeat(60_000) }) }]] as const) {
    let requests = 0;
    const guarded = guardLiveProvider((async () => { requests++; return Response.json({}); }) as typeof fetch, model, []);
    await assert.rejects(guarded(url, options));
    await assert.rejects(guarded(origin, input(2)));
    assert.equal(requests, 0);
  }
  let requests = 0;
  const duplicate = guardLiveProvider((async () => { requests++; return Response.json({}); }) as typeof fetch, model, []);
  await duplicate(origin, input(1));
  await assert.rejects(duplicate(origin, input(1)));
  assert.equal(requests, 1);
  const failed = guardLiveProvider((async () => new Response("{}", { status: 503 })) as typeof fetch, model, []);
  await failed(origin, input(1));
  await assert.rejects(failed(origin, input(2)));
});

test("localhost application calls do not consume the model-call budget", async () => {
  const calls: { index: number; outputCap: number }[] = [];
  const guarded = guardLiveProvider((async () => Response.json({ healthy: true })) as typeof fetch, model, calls);
  await guarded("http://127.0.0.1:4311/api/projects");
  assert.equal(calls.length, 0);
});

test("unreviewed pricing and spend reservations fail before a provider call", async () => {
  assert.throws(() => liveModelPricing("gemini-other"));
  assert.equal(liveModelPricing(model).ceilingUsd, 0.60);
  let requests = 0;
  const fetcher = (async () => { requests++; return Response.json({}); }) as typeof fetch;
  assert.throws(() => guardLiveProvider(fetcher, "gemini-other", []));
  assert.throws(() => guardLiveProvider(fetcher, model, [], 1));
  const guarded = guardLiveProvider(fetcher, model, [], 0.0001);
  await assert.rejects(guarded(origin, input(1)));
  assert.equal(requests, 0);
});
