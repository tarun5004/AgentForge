import { z } from "zod";

const measurement = z.number().finite().nonnegative().nullable();
const tokens = z.number().int().nonnegative().nullable();
export const evaluationRowSchema = z.strictObject({
  id: z.string().min(1).max(100), expected: z.enum(["reply", "clarify", "build"]),
  actual: z.enum(["reply", "clarify", "build"]).nullable(), passed: z.boolean(),
  failures: z.array(z.string().max(300)).max(10), model: z.string().max(200).nullable(),
  latencyMs: measurement, firstTextMs: measurement,
  usage: z.strictObject({ inputTokens: tokens, outputTokens: tokens, totalTokens: tokens }),
});
export type EvaluationRow = z.infer<typeof evaluationRowSchema>;
const reportSchema = z.strictObject({
  version: z.literal(1), mode: z.enum(["live", "fixture"]), transport: z.enum(["json", "stream"]),
  caseHash: z.string().regex(/^[a-f0-9]{64}$/), promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  rows: z.array(evaluationRowSchema).min(1).max(18), summary: z.unknown().optional(),
});
type ReportInput = z.infer<typeof reportSchema>;

// Nearest-rank percentiles are explainable and preserve unknown measurements instead of inventing zeroes.
function percentile(values: (number | null)[], fraction: number) {
  const sorted = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1]! : null;
}

// A partial usage total is labelled explicitly; completely unknown usage stays null.
function tokenTotal(rows: EvaluationRow[], field: keyof EvaluationRow["usage"]) {
  const known = rows.map((row) => row.usage[field]).filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

// Recompute summaries from validated rows, never trust an imported report's claimed success rate.
export function createEvaluationReport(input: ReportInput) {
  const report = reportSchema.parse(input);
  if (new Set(report.rows.map((row) => row.id)).size !== report.rows.length) throw new Error("Duplicate evaluation case IDs.");
  for (const row of report.rows) {
    if (row.passed && (row.actual !== row.expected || row.failures.length)) throw new Error("Inconsistent evaluation grade.");
    if (row.firstTextMs !== null && (report.transport !== "stream" || row.latencyMs === null || row.firstTextMs > row.latencyMs)) throw new Error("Invalid first-text measurement.");
  }
  const passed = report.rows.filter((row) => row.passed).length;
  return { ...report, summary: {
    passed, total: report.rows.length, passRate: passed / report.rows.length,
    latency: { p50Ms: percentile(report.rows.map((row) => row.latencyMs), 0.5), p95Ms: percentile(report.rows.map((row) => row.latencyMs), 0.95) },
    firstText: { measuredCases: report.rows.filter((row) => row.firstTextMs !== null).length,
      p50Ms: percentile(report.rows.map((row) => row.firstTextMs), 0.5), p95Ms: percentile(report.rows.map((row) => row.firstTextMs), 0.95) },
    tokens: { knownInputTokens: tokenTotal(report.rows, "inputTokens"), knownOutputTokens: tokenTotal(report.rows, "outputTokens"),
      knownTotalTokens: tokenTotal(report.rows, "totalTokens"), incompleteUsageCases: report.rows.filter((row) => Object.values(row.usage).some((value) => value === null)).length },
    models: [...new Set(report.rows.map((row) => row.model).filter((model): model is string => model !== null))],
    scope: report.mode === "fixture" ? "Deterministic pipeline checks; not model-quality evidence." : "Reviewed routing/contracts only; not build, browser, visual quality or billing proof.",
  } };
}

// Offline comparison requires the same questions, prompt and transport; model names may differ intentionally.
export function compareEvaluationReports(before: unknown, after: unknown) {
  const a = createEvaluationReport(reportSchema.parse(before));
  const b = createEvaluationReport(reportSchema.parse(after));
  if (a.mode !== b.mode || a.transport !== b.transport || a.caseHash !== b.caseHash || a.promptHash !== b.promptHash ||
      JSON.stringify(a.rows.map(({ id, expected }) => ({ id, expected }))) !== JSON.stringify(b.rows.map(({ id, expected }) => ({ id, expected })))) {
    throw new Error("Compare identical cases, prompt, mode and transport only.");
  }
  return { mode: "offline-comparison", before: a.summary, after: b.summary,
    passRateChangePercentagePoints: (b.summary.passRate - a.summary.passRate) * 100,
    note: "Small reviewed samples are not a held-out benchmark or a guarantee for other prompts." };
}

// Parse options before importing provider configuration; typos cannot accidentally trigger paid calls.
export function parseEvaluationOptions(args: string[]) {
  const options = new Map<string, string>();
  for (const arg of args) {
    const [name, ...parts] = arg.split("=");
    if (!name || options.has(name) || !["--live", "--stream", "--limit", "--case", "--report", "--compare"].includes(name)) throw new Error("Invalid evaluation option.");
    const value = parts.join("=");
    if (["--live", "--stream"].includes(name) ? parts.length > 0 : !value || parts.length !== 1) throw new Error("Invalid evaluation option value.");
    options.set(name, value);
  }
  const limit = Number(options.get("--limit") ?? 3);
  if (!Number.isInteger(limit) || limit < 1 || limit > 18) throw new Error("Evaluation limit must be 1..18.");
  const file = (name: string) => /^[a-zA-Z0-9_-]{1,80}\.json$/.test(name);
  const report = options.get("--report");
  const compare = options.get("--compare")?.split(",");
  if (report && (!options.has("--live") || !file(report))) throw new Error("Report needs --live and a simple .json filename.");
  if (compare && (options.size !== 1 || compare.length !== 2 || compare.some((name) => !file(name)))) throw new Error("Use --compare=before.json,after.json separately.");
  return { live: options.has("--live"), stream: options.has("--stream"), limit, ids: options.get("--case")?.split(","), report, compare };
}
