import assert from "node:assert/strict";
import { test } from "node:test";
import { repairProject, getGeneration, ProjectApiError } from "./project-api.ts";
import { readPendingGeneration, savePendingGeneration, readFailedGeneration, saveFailedGeneration } from "./pending-generation.ts";

const projectId = "100000000000000000000001";
const failedId = "200000000000000000000001";
const repairId = "300000000000000000000001";

test("repair sends only original identity and stable key, and never retries upstream 502", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++; assert.equal(url, `/api/projects/${projectId}/generations/${failedId}/repair`);
    assert.equal(init.method, "POST"); assert.equal(init.body, "{}");
    assert.equal(new Headers(init.headers).get("Idempotency-Key"), "one-stable-key");
    return Response.json({ code: "AI_REPAIR_FAILED", generationId: repairId, message: "Repair failed" }, { status: 502 });
  });
  await assert.rejects(repairProject(projectId, failedId, "fixture-token", "one-stable-key"), (error) =>
    error instanceof ProjectApiError && error.generationId === repairId && error.code === "AI_REPAIR_FAILED");
  assert.equal(calls, 1);
});

test("failed status validates additive repair eligibility instead of trusting a truthy flag", async (context) => {
  const failed = { id: failedId, status: "failed", hasSavedResult: true, errorCode: "BUILD_VERIFICATION_FAILED", repairAvailable: true, repairAttemptId: null };
  context.mock.method(globalThis, "fetch", async () => Response.json({ generation: failed }));
  assert.deepEqual(await getGeneration(projectId, failedId, "fixture-token"), failed);
  for (const change of [{ repairAvailable: "yes" }, { repairAttemptId: "bad-id" }, { repairAttemptId: repairId }, { errorCode: "OUTCOME_UNKNOWN" }]) {
    context.mock.method(globalThis, "fetch", async () => Response.json({ generation: { ...failed, ...change } }));
    await assert.rejects(getGeneration(projectId, failedId, "fixture-token"), /eligibility/);
  }
});

test("tab restoration preserves repair route identity and isolates account/project markers", (context) => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
  } });
  context.after(() => Reflect.deleteProperty(globalThis, "sessionStorage"));
  const intent = { projectId, key: "one-stable-key", body: {}, repairOf: failedId, generationId: repairId };
  savePendingGeneration("owner", intent);
  assert.deepEqual(readPendingGeneration("owner", projectId), intent);
  assert.equal(readPendingGeneration("other", projectId), null);
  saveFailedGeneration("owner", projectId, failedId);
  assert.equal(readFailedGeneration("owner", projectId), failedId);
  assert.equal(readFailedGeneration("other", projectId), null);
  for (const extra of [{ repairOf: "bad-id" }, { briefId: failedId }, { body: { prompt: "Unexpected repair prompt" } }]) {
    savePendingGeneration("owner", { ...intent, ...extra });
    assert.equal(readPendingGeneration("owner", projectId), null);
  }
  saveFailedGeneration("owner", projectId, null); assert.equal(readFailedGeneration("owner", projectId), null);
});
