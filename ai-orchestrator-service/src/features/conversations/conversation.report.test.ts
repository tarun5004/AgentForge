import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compareEvaluationReports, createEvaluationReport, parseEvaluationOptions, type EvaluationRow } from "./conversation.report.js";

const row: EvaluationRow = { id: "greeting", expected: "reply", actual: "reply", passed: true, failures: [], model: "fixture-only",
  latencyMs: 100, firstTextMs: 20, usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } };
const input = { version: 1 as const, mode: "fixture" as const, transport: "stream" as const, caseHash: "a".repeat(64), promptHash: "b".repeat(64), rows: [row] };

test("reports calculate routing accuracy, nearest-rank latency and measured token totals", () => {
  const report = createEvaluationReport({ ...input, rows: [row, { ...row, id: "plan", latencyMs: 300, firstTextMs: 40, passed: false, failures: ["Wrong route"], actual: "build" }] });
  assert.equal(report.summary.passRate, 0.5);
  assert.deepEqual(report.summary.latency, { p50Ms: 100, p95Ms: 300 });
  assert.deepEqual(report.summary.firstText, { measuredCases: 2, p50Ms: 20, p95Ms: 40 });
  assert.equal(report.summary.tokens.knownTotalTokens, 60);
  assert.match(report.summary.scope, /not model-quality/);
});

test("unknown usage/first-text measurements are not fabricated as zero", () => {
  const report = createEvaluationReport({ ...input, transport: "json", rows: [{ ...row, firstTextMs: null, usage: { inputTokens: null, outputTokens: null, totalTokens: null } }] });
  assert.equal(report.summary.tokens.knownTotalTokens, null);
  assert.equal(report.summary.tokens.incompleteUsageCases, 1);
  assert.equal(report.summary.firstText.p50Ms, null);
  assert.equal(report.summary.firstText.measuredCases, 0);
});

test("reports reject duplicate cases, false passing grades and invalid timing", () => {
  for (const rows of [[row, row], [{ ...row, actual: "build" }], [{ ...row, firstTextMs: 101 }], [{ ...row, latencyMs: NaN }]]) {
    assert.throws(() => createEvaluationReport({ ...input, rows: rows as EvaluationRow[] }));
  }
});

test("offline comparisons require matching cases/prompt/transport and recompute imported summaries", () => {
  const before = createEvaluationReport(input);
  const after = createEvaluationReport({ ...input, rows: [{ ...row, passed: false, actual: "clarify", failures: ["Wrong route"] }] });
  const compared = compareEvaluationReports({ ...before, summary: { passRate: 999 } }, after);
  assert.equal(compared.before.passRate, 1);
  assert.equal(compared.passRateChangePercentagePoints, -100);
  for (const change of [{ promptHash: "c".repeat(64) }, { caseHash: "c".repeat(64) }, { mode: "live" }, { transport: "json", rows: [{ ...row, firstTextMs: null }] }]) {
    assert.throws(() => compareEvaluationReports(before, { ...after, ...change }));
  }
});

test("CLI admission rejects typos, duplicate switches, oversized batches and arbitrary file paths", () => {
  assert.equal(parseEvaluationOptions([]).live, false);
  assert.equal(parseEvaluationOptions(["--live", "--stream", "--limit=2", "--report=after.json"]).limit, 2);
  assert.deepEqual(parseEvaluationOptions(["--compare=before.json,after.json"]).compare, ["before.json", "after.json"]);
  for (const args of [["--lvie"], ["--live", "--live"], ["--live=true"], ["--limit=19"], ["--report=x.json"], ["--live", "--report=../../.env"], ["--compare=a.json,b.json", "--live"]]) {
    assert.throws(() => parseEvaluationOptions(args));
  }
});

test("actual default CLI lists reviewed cases without credentials or a running server", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./conversation.eval-cli.ts", import.meta.url))], {
    encoding: "utf8", timeout: 20_000, env: { ...process.env, AI_PROVIDER: "invalid-to-detect-accidental-import" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No API calls made/);
  assert.match(result.stdout, /portfolio-plan/);
  assert.ok(!result.stdout.includes("injected env"));
});
