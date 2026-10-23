import assert from "node:assert/strict";
import { test } from "node:test";
import { briefFingerprint, parseBriefSubmission, prepareRequirementRequest, validateAssessment } from "./requirement.contract.js";

const id = "100000000000000000000001";
const prompt = "Build my portfolio website";
const assessment = {
  requestId: id, status: "ready", message: "Please review the brief.",
  brief: "Build a portfolio for Ada, a developer.", questions: [],
  policyVersion: "frontend-requirements-v1", model: "test-fixture",
  usage: { inputTokens: null, outputTokens: null, totalTokens: null }, latencyMs: 0,
};

test("strict brief input rejects owner/model overrides, invalid versions and duplicate questions", () => {
  for (const body of [undefined, null, {}, { expectedVersion: -1 }, { expectedVersion: 1.5 },
    { expectedVersion: 0, ownerId: id }, { expectedVersion: 0, prompt },
    { expectedVersion: 0, answers: [{ question: "Name?", answer: "Ada" }, { question: " NAME? ", answer: "Bob" }] },
    { expectedVersion: 0, answers: [{ question: "Name?", answer: " " }] }]) {
    assert.throws(() => parseBriefSubmission(body));
  }
  assert.deepEqual(parseBriefSubmission({ expectedVersion: 0 }), { expectedVersion: 0, answers: [] });
});

test("fingerprint normalizes answer order/question identity but binds version, prompt and answer", () => {
  const first = parseBriefSubmission({ expectedVersion: 1, answers: [{ question: "Name?", answer: "Ada" }, { question: "Your role?", answer: "Developer" }] });
  const equivalent = parseBriefSubmission({ expectedVersion: 1, answers: [{ question: " YOUR  ROLE? ", answer: "Developer" }, { question: "name?", answer: " Ada " }] });
  assert.equal(briefFingerprint(id, prompt, first), briefFingerprint(id, prompt, equivalent));
  for (const changed of [{ ...first, expectedVersion: 2 }, { ...first, answers: [{ question: "Name?", answer: "Bob" }] }]) {
    assert.notEqual(briefFingerprint(id, prompt, first), briefFingerprint(id, prompt, changed));
  }
  assert.notEqual(briefFingerprint(id, prompt, first), briefFingerprint(id, prompt + "!", first));
});

test("legacy invalid prompts and UTF-8 byte overflow fail before admission without truncation", () => {
  const submission = parseBriefSubmission({ expectedVersion: 0 });
  for (const invalid of ["short", "x".repeat(1001)]) assert.throws(() => prepareRequirementRequest(id, invalid, submission, id));
  const large = parseBriefSubmission({ expectedVersion: 0, answers: Array.from({ length: 6 }, (_, i) => ({ question: `Question ${i}?`, answer: "漢".repeat(1000) })) });
  assert.throws(() => prepareRequirementRequest(id, "漢".repeat(1000), large, id), /too large/);
  assert.equal(prepareRequirementRequest(id, prompt, submission, id).prompt, prompt);
});

test("upstream response must match the attempt and question/status contract", () => {
  assert.deepEqual(validateAssessment(assessment, id, []), assessment);
  for (const invalid of [{ ...assessment, requestId: "wrong" }, { ...assessment, questions: ["Name?"] },
    { ...assessment, status: "needs_clarification" },
    { ...assessment, status: "needs_clarification", questions: ["Name?", " NAME? "] },
    { ...assessment, usage: { inputTokens: -1, outputTokens: 0, totalTokens: 0 } },
    { ...assessment, ownerId: id }]) assert.throws(() => validateAssessment(invalid, id, []));
  assert.throws(() => validateAssessment({ ...assessment, status: "needs_clarification", questions: ["Name?"] }, id, [{ question: "name?", answer: "Ada" }]));
});
