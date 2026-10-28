import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareRepairRequest, safeRepairDiagnostics } from "./repair.contract.js";
import { repairFingerprint, isRepairable } from "../services/repair.policy.js";
import type { GenerationReadRecord } from "../repositories/generation.repository.js";

const files = [{ path: "app/page.tsx", content: "export default function Page() { return <h1>Page</h1> }" }];
const row = { path: "app/page.tsx", line: 1, column: 3, category: "typescript" as const, code: "TS2304" };

test("repair feedback cannot carry raw messages, foreign paths or forged code strings", () => {
  assert.deepEqual(safeRepairDiagnostics([row], files), [row]);
  for (const input of [[{ ...row, message: "PRIVATE_LOG" }], [{ ...row, path: "/host/private" }],
    [{ ...row, code: "PRIVATE" }], [{ ...row, path: null }], Array.from({ length: 9 }, () => row)]) {
    assert.deepEqual(safeRepairDiagnostics(input, files), []);
  }
});

test("repair preflight validates the complete candidate and serialized bytes without truncation", () => {
  const input = { requestId: "test", projectId: "100000000000000000000001", prompt: "Build a portfolio frontend", failedFiles: files, diagnostics: [row] };
  assert.deepEqual(prepareRepairRequest(input).failedFiles, files);
  assert.throws(() => prepareRepairRequest({ ...input, diagnostics: [] }));
  assert.throws(() => prepareRepairRequest({ ...input, failedFiles: [{ path: "app/api/route.ts", content: "backend" }] }));
  assert.throws(() => prepareRepairRequest({ ...input, failedFiles: [{ path: "app/page.tsx", content: "\u0000".repeat(30_000) },
    { path: "app/layout.tsx", content: "\u0000".repeat(30_000) }] }), /context is too large/);
});

test("repair eligibility rejects uncertain, legacy, already-proven and recursive candidates", () => {
  const candidate = { status: "failed", errorCode: "BUILD_VERIFICATION_FAILED", buildPolicyVersion: "next-static-build-v1",
    requestPolicyVersion: "generation-request-v1", requestFingerprint: "a".repeat(64), sourcePrompt: "Build a portfolio", expectedVersion: 1,
    result: { files }, buildDiagnostics: [row] } as GenerationReadRecord;
  assert.equal(isRepairable(candidate), true);
  for (const change of [{ status: "pending" }, { errorCode: "OUTCOME_UNKNOWN" }, { repairOf: "original-id" },
    { expectedVersion: undefined }, { sourcePrompt: undefined }, { buildDiagnostics: undefined },
    { buildVerification: {} }, { buildPolicyVersion: undefined }]) {
    assert.equal(isRepairable({ ...candidate, ...change } as GenerationReadRecord), false);
  }
  assert.equal(repairFingerprint("project", "attempt"), repairFingerprint("project", "attempt"));
  assert.notEqual(repairFingerprint("project", "attempt"), repairFingerprint("project", "other"));
});
