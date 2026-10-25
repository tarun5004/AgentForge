import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { test } from "node:test";
import { generationRequestSchema, type GenerationRequest } from "../features/generations/generation.schema.js";
import { parseSmokeOptions, runGenerationSmoke, SmokeError } from "./generation-smoke.js";

const approved = parseSmokeOptions(["--execute", "--allow-paid"]);
const identity = { ok: true, service: "ai-orchestrator-service" };

// A deterministic response exercises the real contract without credentials or a model request.
function result(request: GenerationRequest) {
  return { generation: { requestId: request.requestId, provider: "vercel-ai-gateway", model: "fixture/frontend",
    summary: "One minimal fixture page", files: [{ path: "app/page.tsx", content: "export default function Page() { return <h1>SMOKE_CODE_MARKER</h1>; }" }],
    deletedPaths: [], validation: { policyVersion: "frontend-manifest-v1", status: "manifest_validated" },
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, latencyMs: 1 } };
}

// Keep test failures readable without exposing arbitrary service messages in assertion output.
function hasCode(code: string) {
  return (error: unknown) => error instanceof SmokeError && error.code === code;
}

// Model the local HTTP boundary only; no fake provider switch is added to the application.
function transport(reply: (request: GenerationRequest) => Response) {
  let calls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls++;
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return init?.method === "POST" ? reply(JSON.parse(String(init.body)) as GenerationRequest) : Response.json(identity);
  };
  return { fetcher, calls: () => calls };
}

// A plain command cannot spend credits or require the caller to load any secret.
test("default dry-run validates its request and makes zero network calls", async () => {
  const fake = transport(() => { throw new Error("Must never send a request."); });
  const report = await runGenerationSmoke(parseSmokeOptions([]), undefined, fake.fetcher);
  assert.equal(report.mode, "dry-run");
  assert.equal(report.generationRequests, 0);
  assert.equal(fake.calls(), 0);
});

// Confirmation flags must be paired; unknown/token flags never silently enable execution.
test("execution options reject partial confirmation, typos and duplicates", () => {
  assert.equal(approved.execute, true);
  for (const args of [["--execute"], ["--allow-paid"], ["--execute", "--execute"], ["--token", "private"], ["--url"], ["--force"]]) {
    assert.throws(() => parseSmokeOptions(args), SmokeError);
  }
});

// Prevent secret-bearing URLs, redirects or a mistyped public host from receiving the internal token.
test("smoke URLs are exact loopback origins, not arbitrary targets", () => {
  assert.equal(parseSmokeOptions([]).url, "http://127.0.0.1:6001");
  assert.throws(() => parseSmokeOptions(["--url", "http://localhost:6000"]), hasCode("FETCH_BLOCKED_PORT_6000"));
  assert.equal(parseSmokeOptions(["--url", "http://localhost:6001/"]).url, "http://localhost:6001");
  for (const url of ["http://example.com", "http://localhost.evil.test", "https://localhost:6001", "http://0.0.0.0:6001",
    "http://user:private@localhost:6001", "http://localhost:6001/path", "http://localhost:6001?", "http://localhost:6001#",
    "http://localhost:6001\r\nx: private"]) assert.throws(() => parseSmokeOptions(["--url", url]), hasCode("INVALID_LOCAL_ORIGIN"));
});

// Defense in depth applies even if a future internal caller skips the CLI parser.
test("unconfirmed execution and missing credentials fail before network access", async () => {
  const fake = transport(() => Response.json({}));
  await assert.rejects(runGenerationSmoke({ ...approved, allowPaid: false }, "fixture-token", fake.fetcher), hasCode("BOTH_EXECUTION_FLAGS_REQUIRED"));
  await assert.rejects(runGenerationSmoke(approved, undefined, fake.fetcher), hasCode("INTERNAL_TOKEN_REQUIRED"));
  await assert.rejects(runGenerationSmoke({ ...approved, url: "http://example.com" }, "fixture-token", fake.fetcher), hasCode("INVALID_LOCAL_ORIGIN"));
  assert.equal(fake.calls(), 0);
});

// Health must identify the AI service before any credential or generation body is sent.
test("a wrong or unavailable health endpoint cannot trigger generation", async () => {
  let calls = 0;
  const wrong: typeof fetch = async (_url, init) => {
    calls++;
    assert.equal(init?.headers, undefined);
    return Response.json({ ok: true, service: "other-service" });
  };
  await assert.rejects(runGenerationSmoke(approved, "fixture-token", wrong), hasCode("WRONG_SERVICE"));
  assert.equal(calls, 1);
  await assert.rejects(runGenerationSmoke(approved, "fixture-token", async () => { throw new Error("private diagnostic"); }), hasCode("SERVICE_UNAVAILABLE"));
});

// The public summary contains bounded metadata, never generated source or the service credential.
test("success validates the manifest and returns a content-free usage report", async () => {
  const fake = transport(request => Response.json(result(request)));
  const report = await runGenerationSmoke(approved, "fixture-token", fake.fetcher);
  assert.equal(report.mode, "executed");
  assert.equal(report.generationRequests, 1);
  assert.equal(fake.calls(), 2); // health GET and exactly one generation POST
  assert.ok("usage" in report);
  assert.deepEqual(report.usage, { inputTokens: 10, outputTokens: 20, totalTokens: 30 });
  assert.doesNotMatch(JSON.stringify(report), /SMOKE_CODE_MARKER|fixture-token/);
});

// Direct Google responses use a native model ID; the same smoke contract must accept them.
test("smoke validation accepts direct Google metadata without requiring Gateway slugs", async () => {
  const fake = transport(request => {
    const response = result(request);
    response.generation.provider = "google";
    response.generation.model = "gemini-3.8-flash";
    return Response.json(response);
  });
  const report = await runGenerationSmoke(approved, "fixture-token", fake.fetcher);
  assert.equal(report.model, "gemini-3.8-flash");
  assert.equal(fake.calls(), 2);
});

// Lost responses and provider failures must never trigger an automatic additional paid attempt.
test("HTTP errors and transport uncertainty are sanitized and never retried", async () => {
  const rejected = transport(() => new Response("private diagnostic and token", { status: 502 }));
  await assert.rejects(runGenerationSmoke(approved, "fixture-token", rejected.fetcher), hasCode("HTTP_502"));
  assert.equal(rejected.calls(), 2);
  const lost = transport(() => { throw new Error("private diagnostic"); });
  await assert.rejects(runGenerationSmoke(approved, "fixture-token", lost.fetcher), hasCode("SUBMITTED_OUTCOME_UNKNOWN"));
  assert.equal(lost.calls(), 2);
});

// A successful HTTP status is insufficient: identity, JSON, metadata and source policy must match.
test("malformed, mismatched and unsafe successful outputs are rejected", async () => {
  const mismatched = transport(request => Response.json({ generation: { ...result(request).generation, requestId: "stale" } }));
  await assert.rejects(runGenerationSmoke(approved, "fixture-token", mismatched.fetcher), hasCode("INVALID_RESPONSE"));
  const malformed = transport(() => new Response("not json"));
  await assert.rejects(runGenerationSmoke(approved, "fixture-token", malformed.fetcher), hasCode("INVALID_RESPONSE"));
  const unsafe = transport(request => {
    const body = result(request);
    body.generation.files[0]!.path = "app/api/route.ts";
    return Response.json(body);
  });
  await assert.rejects(runGenerationSmoke(approved, "fixture-token", unsafe.fetcher), hasCode("INVALID_MANIFEST"));
});

// Bound body bytes rather than trusting Content-Length from an upstream server.
test("oversized responses fail closed", async () => {
  const fake = transport(() => new Response("x".repeat(1_048_577)));
  await assert.rejects(runGenerationSmoke(approved, "fixture-token", fake.fetcher), hasCode("RESPONSE_TOO_LARGE"));
});

// An actual loopback listener proves the helper sends the documented token/header/body contract.
test("real local HTTP fixture accepts one validated request without a provider", async () => {
  let posts = 0;
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/_status/healthz") { response.end(JSON.stringify(identity)); return; }
    assert.equal(request.url, "/internal/generations");
    assert.equal(request.method, "POST");
    assert.equal(request.headers["x-internal-service-token"], "fixture-token");
    posts++;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = generationRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    assert.equal(request.headers["x-request-id"], input.requestId);
    response.end(JSON.stringify(result(input)));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const report = await runGenerationSmoke({ ...approved, url: `http://127.0.0.1:${address.port}` }, "fixture-token");
    assert.equal(report.mode, "executed");
    assert.equal(posts, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

// Real Fetch must refuse a redirect rather than forward the internal credential to another listener.
test("a generation redirect is not followed or retried", async () => {
  let destinationRequests = 0;
  let posts = 0;
  const destination = createServer((_request, response) => { destinationRequests++; response.end("unexpected"); });
  const source = createServer((request, response) => {
    if (request.url === "/_status/healthz") { response.end(JSON.stringify(identity)); return; }
    posts++;
    const address = destination.address();
    assert.ok(address && typeof address !== "string");
    response.writeHead(307, { location: `http://127.0.0.1:${address.port}/other` }).end();
  });
  destination.listen(0, "127.0.0.1");
  await once(destination, "listening");
  source.listen(0, "127.0.0.1");
  await once(source, "listening");
  const address = source.address();
  assert.ok(address && typeof address !== "string");
  try {
    await assert.rejects(runGenerationSmoke({ ...approved, url: `http://127.0.0.1:${address.port}` }, "fixture-token"), hasCode("SUBMITTED_OUTCOME_UNKNOWN"));
    assert.equal(posts, 1);
    assert.equal(destinationRequests, 0);
  } finally {
    await Promise.all([source, destination].map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }));
  }
});

// CLI defaults/help must remain safe even if a credential exists in the developer's environment.
test("actual CLI dry-run and help do not echo a credential or require a running service", () => {
  const cli = resolve("src/verification/generation-smoke.cli.ts");
  const tsx = resolve("../node_modules/tsx/dist/cli.mjs");
  for (const args of [[], ["--help"]]) {
    const output = execFileSync(process.execPath, [tsx, cli, ...args], { encoding: "utf8", timeout: 10_000,
      env: { ...process.env, INTERNAL_SERVICE_TOKEN: "never-echo-this-fixture-token" } });
    assert.doesNotMatch(output, /never-echo-this-fixture-token/);
    assert.match(output, args.length ? /Default: no network/ : /"networkRequests": 0/);
  }
});
