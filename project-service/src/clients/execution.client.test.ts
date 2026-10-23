import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../middlewares/error.middleware.js";

// Supply fake config before importing the network boundary; these tests never connect to Mongo or a provider.
Object.assign(process.env, { NODE_ENV: "test", MONGODB_URI: "mongodb://127.0.0.1:27017/agentforge_test_unused_client",
  ACCESS_TOKEN_SECRET: "fixture-access-secret", INTERNAL_SERVICE_TOKEN: "fixture-ai-secret", BUILD_GATE_ENABLED: "true",
  EXECUTION_CHECK_TOKEN: "fixture-execution-service-token-0001", EXECUTION_SERVICE_URL: "http://127.0.0.1:5100" });
const { requestCandidateCheck } = await import("./execution.client.js");
const input = { projectId: "100000000000000000000001", generationId: "200000000000000000000001", snapshotHash: "a".repeat(64) };
const proof = { status: "build_passed", policyVersion: "next-static-build-v1", snapshotHash: input.snapshotHash,
  runnerImageId: `sha256:${"b".repeat(64)}`, checkId: "12345678-1234-4234-8234-123456789abc", completedAt: "2026-10-23T00:00:00.000Z" };

test("internal check sends only candidate identity and both headers, then validates exact proof", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "http://127.0.0.1:5100/internal/checks");
    assert.equal(options?.method, "POST"); assert.deepEqual(JSON.parse(String(options?.body)), input);
    assert.equal(new Headers(options?.headers).get("authorization"), "Bearer fixture-owner");
    assert.equal(new Headers(options?.headers).get("x-execution-check-token"), process.env.EXECUTION_CHECK_TOKEN);
    assert(options?.signal); return Response.json({ buildVerification: proof });
  };
  try { assert.deepEqual(await requestCandidateCheck(input, "Bearer fixture-owner"), proof); }
  finally { globalThis.fetch = original; }
});

test("forged/malformed proof and internal auth failures remain uncertain, never a browser logout", async () => {
  const original = globalThis.fetch;
  try {
    for (const response of [Response.json({ buildVerification: { ...proof, snapshotHash: "c".repeat(64) } }),
      Response.json({}, { status: 401 }), Response.json({}, { status: 429 }), new Response("invalid JSON"),
      new Response("x".repeat(20_000)), Response.json({ buildVerification: { ...proof, policyVersion: "other" } })]) {
      globalThis.fetch = async () => response;
      await assert.rejects(requestCandidateCheck(input, "Bearer fixture-owner"), (error: unknown) => error instanceof AppError && error.statusCode === 503 && error.code === "OUTCOME_UNKNOWN");
    }
  } finally { globalThis.fetch = original; }
});

test("only explicit trusted compile/source-policy rejection becomes a terminal failure", async () => {
  const original = globalThis.fetch;
  try {
    for (const code of ["BUILD_VERIFICATION_FAILED", "CANDIDATE_UNSUPPORTED"]) {
      globalThis.fetch = async () => Response.json({ code, message: "untrusted diagnostic must not leak" }, { status: 422 });
      await assert.rejects(requestCandidateCheck(input, "Bearer fixture-owner"), (error: unknown) => error instanceof AppError && error.code === "BUILD_VERIFICATION_FAILED" && !error.message.includes("untrusted diagnostic"));
    }
  } finally { globalThis.fetch = original; }
});
