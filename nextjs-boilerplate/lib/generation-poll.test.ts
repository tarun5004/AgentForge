import assert from "node:assert/strict";
import { test } from "node:test";
import { generateProject, getGeneration, ProjectApiError, type GenerationStatus } from "./project-api.ts";
import { pollGeneration, waitForPoll } from "./generation-poll.ts";

const projectId = "100000000000000000000001";
const generationId = "300000000000000000000001";
const pending = { id: generationId, status: "pending" as const, hasSavedResult: true, errorCode: null };
const ready: GenerationStatus = { id: generationId, status: "ready", revisionId: "200000000000000000000001", revisionVersion: 1,
  parentRevisionId: null, sourcePrompt: "Build a frontend page", provider: "fixture", model: "fixture", summary: "Saved fixture",
  files: [{ path: "app/page.tsx", content: "fixture" }], fileChanges: [], validation: null,
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1 };

// The future server may accept work without publishing files; the client must retain that identity.
test("202 accepted is parsed as pending, not a fabricated ready revision", async context => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ generation: pending }, { status: 202 }));
  assert.deepEqual(await generateProject(projectId, "fixture-token", "stable-key", {}), pending);
});

// Deterministic GET fixtures exercise polling without another POST, provider call or real timer delay.
test("pending polling uses only GET and stops at a confirmed terminal status", async context => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.ok(init.method === undefined || init.method === "GET");
    assert.ok(init.signal);
    calls++;
    return Response.json({ generation: calls < 3 ? pending : { ...pending, status: "failed", errorCode: "BUILD_VERIFICATION_FAILED" } });
  });
  const signal = new AbortController().signal;
  const result = await pollGeneration(generationId, signal => getGeneration(projectId, generationId, "fixture-token", signal), signal, async () => {});
  assert.equal(result.status, "failed");
  assert.equal(calls, 3);
});

test("progress observers receive only validated, matching status responses without extra requests", async () => {
  const observations: GenerationStatus[] = [];
  let reads = 0;
  const result = await pollGeneration(generationId, async () => ++reads === 1 ? pending : ready,
    new AbortController().signal, async () => {}, status => observations.push(status));
  assert.equal(result, ready);
  assert.deepEqual(observations, [pending, ready]);
  assert.equal(reads, 2);
});

// Bounds prevent endless background work; the error retains the ID for explicit status/replay.
test("poll limit preserves uncertainty rather than inventing a failed generation", async () => {
  let calls = 0;
  await assert.rejects(pollGeneration(generationId, async () => { calls++; return pending; }, new AbortController().signal, async () => {}), error => {
    assert.ok(error instanceof ProjectApiError);
    assert.equal(error.status, 503);
    assert.equal(error.generationId, generationId);
    return true;
  });
  assert.equal(calls, 180);
});

// Navigating away can cancel polling, but must never start another generation or clear its key.
test("abort before or during the wait prevents the next status request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const read = async () => { calls++; return pending; };
  await assert.rejects(pollGeneration(generationId, read, controller.signal, async () => controller.abort()));
  await assert.rejects(pollGeneration(generationId, read, controller.signal, async () => {}));
  assert.equal(calls, 0);
});

// A stale/malformed result cannot finish an unrelated attempt.
test("polling refuses a different generation identity", async () => {
  await assert.rejects(pollGeneration(generationId, async () => ({ ...pending, id: "300000000000000000000002" }), new AbortController().signal, async () => {}), /identity/);
});

// A proxy's 502 during GET must not trigger the submission path's terminal-AI-failure cleanup.
test("status read failures preserve uncertainty while a definite 401 remains an auth rejection", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(pollGeneration(generationId, async () => { throw new ProjectApiError("Proxy failed", 502); }, signal, async () => {}), error => {
    assert.ok(error instanceof ProjectApiError);
    assert.equal(error.status, 503);
    assert.equal(error.generationId, generationId);
    return true;
  });
  await assert.rejects(pollGeneration(generationId, async () => { throw new ProjectApiError("Sign in", 401); }, signal, async () => {}), error => error instanceof ProjectApiError && error.status === 401);
});

// A committed snapshot ends polling immediately; no second status call or retry is needed.
test("ready evidence ends polling without replacing its committed snapshot", async () => {
  let calls = 0;
  assert.equal(await pollGeneration(generationId, async () => { calls++; return ready; }, new AbortController().signal, async () => {}), ready);
  assert.equal(calls, 1);
});

// The production delay must release its actual timer when a component unmounts.
test("real polling delay aborts and releases its timer", async () => {
  const controller = new AbortController();
  const waiting = waitForPoll(controller.signal);
  controller.abort();
  await assert.rejects(waiting);
});

// Pending responses and build evidence must pass their own guards, not just a successful HTTP status.
test("malformed pending responses are rejected", async context => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ generation: { ...pending, id: "bad-id" } }, { status: 202 }));
  await assert.rejects(generateProject(projectId, "fixture-token", "stable-key", {}), /Invalid generation/);
  context.mock.method(globalThis, "fetch", async () => Response.json({ generation: { ...pending, errorCode: "unexpected" } }, { status: 202 }));
  await assert.rejects(generateProject(projectId, "fixture-token", "stable-key", {}), /Invalid generation/);
});

// Schema-valid evidence may be displayed; a malformed proof must not become a verified badge.
test("build evidence accepts the agreed shape and rejects a malformed snapshot hash", async context => {
  const evidence = { status: "build_passed", policyVersion: "next-static-build-v1", snapshotHash: "a".repeat(64),
    runnerImageId: `sha256:${"b".repeat(64)}`, checkId: "12345678-1234-1234-1234-123456789abc", completedAt: "2026-10-23T00:00:00.000Z" };
  context.mock.method(globalThis, "fetch", async () => Response.json({ generation: { ...ready, buildVerification: evidence } }));
  assert.equal((await generateProject(projectId, "fixture-token", "stable-key", {})).status, "ready");
  context.mock.method(globalThis, "fetch", async () => Response.json({ generation: { ...ready, buildVerification: { ...evidence, snapshotHash: "invalid" } } }));
  await assert.rejects(generateProject(projectId, "fixture-token", "stable-key", {}), /Invalid generation/);
});
