import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateHash, matchingBuildVerification } from "./build-verification.js";

const files = [{ path: "app/page.tsx", content: "hello नमस्ते 😀" }, { path: "app/globals.css", content: "body {}" }];
const proof = { status: "build_passed", policyVersion: "next-static-build-v1", snapshotHash: candidateHash(files),
  runnerImageId: `sha256:${"a".repeat(64)}`, checkId: "12345678-1234-4234-8234-123456789abc", completedAt: "2026-10-23T00:00:00.000Z" };

test("proof binds exact source bytes, independent of file order or unrelated object fields", () => {
  assert.equal(candidateHash(files), candidateHash([...files].reverse()));
  assert.deepEqual(matchingBuildVerification(proof, files), proof);
  assert(matchingBuildVerification(proof, [...files].reverse()));
  assert.equal(matchingBuildVerification(proof, [{ ...files[0]!, content: "changed" }, files[1]!]), null);
});

test("legacy, wrong-policy and malformed build evidence never becomes a pass", () => {
  for (const value of [undefined, null, {}, { ...proof, policyVersion: "other" }, { ...proof, status: "failed" },
    { ...proof, runnerImageId: "latest" }, { ...proof, checkId: "not-a-check" }, { ...proof, completedAt: "yesterday" },
    { ...proof, snapshotHash: "b".repeat(64) }]) {
    assert.equal(matchingBuildVerification(value, files), null);
  }
});
