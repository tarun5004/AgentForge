import assert from "node:assert/strict";
import { test } from "node:test";
import { mongo } from "mongoose";

import { createGenerationIntent, validateGenerationBody, validateIdempotencyKey } from "./generation-request.js";
import { isGenerationKeyDuplicate } from "../repositories/generation.repository.js";

const projectId = "100000000000000000000001";
const initialPrompt = "Build a developer portfolio page";

test("empty generation bodies preserve the saved initial prompt", () => {
  assert.deepEqual(validateGenerationBody(undefined), {});
  assert.deepEqual(validateGenerationBody({}), {});
  const intent = createGenerationIntent(projectId, initialPrompt, {});
  assert.equal(intent.sourcePrompt, initialPrompt);
  assert.equal(intent.baseRevisionId, null);
  assert.match(intent.requestFingerprint, /^[a-f\d]{64}$/);
});

test("canonical intent treats trimmed prompts and ID casing consistently", () => {
  const first = createGenerationIntent(projectId, initialPrompt, {
    prompt: "  Make the hero darker  ", baseRevisionId: "ABCDEF1234567890ABCDEF12",
  });
  const second = createGenerationIntent(projectId, initialPrompt, {
    baseRevisionId: "abcdef1234567890abcdef12", prompt: "Make the hero darker",
  });
  assert.deepEqual(first, second);
});

test("changing prompt, project or selected base changes the fingerprint", () => {
  const original = createGenerationIntent(projectId, initialPrompt, {});
  for (const changed of [
    createGenerationIntent("100000000000000000000002", initialPrompt, {}),
    createGenerationIntent(projectId, initialPrompt, { prompt: "Build a restaurant landing page" }),
    createGenerationIntent(projectId, initialPrompt, { prompt: initialPrompt, baseRevisionId: "200000000000000000000001" }),
  ]) assert.notEqual(changed.requestFingerprint, original.requestFingerprint);
});

test("generation body rejects invalid, oversized and browser-controlled fields", () => {
  for (const body of [null, [], "text", { prompt: "short" }, { prompt: "x".repeat(1001) },
    { ownerId: "someone" }, { files: [] }, { expectedVersion: 1 }, { model: "anything" },
    { baseRevisionId: "bad", prompt: initialPrompt }, { baseRevisionId: "200000000000000000000001" }]) {
    assert.throws(() => validateGenerationBody(body), { statusCode: 400 });
  }
});

test("idempotency keys are required and bounded without changing their case", () => {
  assert.equal(validateIdempotencyKey("  My-Key  "), "My-Key");
  for (const key of [undefined, null, [], "", "  ", "x".repeat(101)]) {
    assert.throws(() => validateIdempotencyKey(key), { statusCode: 400 });
  }
});

test("only the exact generation idempotency index is treated as a replay race", () => {
  const duplicate = new mongo.MongoServerError({ message: "duplicate", code: 11000,
    keyPattern: { projectId: 1, idempotencyKey: 1 } });
  assert.equal(isGenerationKeyDuplicate(duplicate), true);
  assert.equal(isGenerationKeyDuplicate(new mongo.MongoServerError({ message: "other index", code: 11000, keyPattern: { _id: 1 } })), false);
  assert.equal(isGenerationKeyDuplicate(new Error("not a duplicate")), false);
  assert.equal(isGenerationKeyDuplicate({ code: 11000 }), false);
});
