import assert from "node:assert/strict";
import { test } from "node:test";
import { finishFixtureCleanup } from "./fixture-cleanup.mts";

// Successful cleanup releases its connection after deleting only its own fixture data.
test("successful cleanup disconnects in order and returns exit status zero", async () => {
  const steps: string[] = [];
  const result = await finishFixtureCleanup(async () => { steps.push("cleanup"); }, async () => { steps.push("disconnect"); });
  assert.equal(result, 0);
  assert.deepEqual(steps, ["cleanup", "disconnect"]);
});

// A delete/read failure must not skip finally or leave an unhandled rejected promise.
test("failed cleanup still disconnects and reports failure", async () => {
  let disconnected = false;
  const result = await finishFixtureCleanup(async () => { throw new Error("test-only cleanup failure"); }, async () => { disconnected = true; });
  assert.equal(result, 1);
  assert.equal(disconnected, true);
});

// Connection-release errors also become explicit failure instead of uncaught rejection.
test("failed disconnect reports failure without rejecting", async () => {
  const result = await finishFixtureCleanup(async () => {}, async () => { throw new Error("test-only disconnect failure"); });
  assert.equal(result, 1);
});

// Both failures are reported without exposing raw database/provider error text.
test("combined failures use sanitized logs and preserve a failing result", async (context) => {
  const messages: string[] = [];
  context.mock.method(process.stderr, "write", (message: string) => { messages.push(message); return true; });
  const fail = async () => { throw new Error("sensitive fixture diagnostic must never appear"); };
  assert.equal(await finishFixtureCleanup(fail, fail), 1);
  assert.deepEqual(messages.map((message) => JSON.parse(message).message), ["fixture_cleanup_failed", "fixture_disconnect_failed"]);
  assert.equal(messages.join("").includes("sensitive fixture diagnostic"), false);
});
