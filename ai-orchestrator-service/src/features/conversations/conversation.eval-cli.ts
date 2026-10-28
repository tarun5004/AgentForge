import { conversationCases, gradeConversation } from "./conversation.evaluation.js";
import { conversationRequestSchema } from "./conversation.schema.js";
import { createEvaluationReport, compareEvaluationReports, parseEvaluationOptions, type EvaluationRow } from "./conversation.report.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const reportDirectory = fileURLToPath(new URL("../../../../output/evaluations/", import.meta.url));

// Only small named local reports are accepted; comparison never imports credentials or calls a provider.
async function readReport(name: string) {
  const path = new URL(name, new URL("../../../../output/evaluations/", import.meta.url));
  if ((await stat(path)).size > 1_000_000) throw new Error("Report exceeds size limit.");
  return JSON.parse(await readFile(path, "utf8"));
}

// Explicit opt-in and a tiny default batch prevent accidentally running all cases against a paid model.
async function main() {
  const options = parseEvaluationOptions(process.argv.slice(2));
  if (options.compare) {
    process.stdout.write(`${JSON.stringify(compareEvaluationReports(await readReport(options.compare[0]!), await readReport(options.compare[1]!)), null, 2)}\n`);
    return;
  }
  if (!options.live) {
    process.stdout.write("No API calls made. Use --live --limit=3 (1..18), optionally --case=greeting,portfolio-plan.\n");
    process.stdout.write(`${JSON.stringify({ mode: "case-list", cases: conversationCases.map(({ id, expected }) => ({ id, expected })) }, null, 2)}\n`);
    return;
  }
  if (options.ids?.some((id) => !conversationCases.some((item) => item.id === id))) {
    throw new Error("Invalid evaluation selection.");
  }
  if (options.report) {
    // Refuse an existing target before spending tokens, not only when saving the final report.
    try {
      await stat(new URL(options.report, new URL("../../../../output/evaluations/", import.meta.url)));
      throw new Error("Report already exists. Choose a new filename.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const selected = conversationCases.filter(({ id }) => !options.ids || options.ids.includes(id)).slice(0, options.limit);
  const { respondToConversation, streamConversation, CONVERSATION_INSTRUCTIONS } = await import("./conversation.service.js");
  const rows: EvaluationRow[] = [];
  for (const scenario of selected) {
    const startedAt = Date.now();
    let firstTextMs: number | null = null;
    try {
      const input = conversationRequestSchema.parse({ requestId: `eval-${scenario.id}`, messages: scenario.messages });
      const response = options.stream ? await streamConversation(input, async (message) => {
        if (message && firstTextMs === null) firstTextMs = Date.now() - startedAt;
      }, AbortSignal.timeout(45_000)) : await respondToConversation(input);
      const grade = gradeConversation(scenario.expected, response);
      rows.push({ id: scenario.id, expected: scenario.expected, actual: response.action, ...grade, model: response.model,
        usage: response.usage, latencyMs: Date.now() - startedAt, firstTextMs });
    } catch {
      rows.push({ id: scenario.id, expected: scenario.expected, actual: null, passed: false,
        failures: ["Provider/output/retrieval failure; stopped without retry."], model: null, latencyMs: Date.now() - startedAt, firstTextMs,
        usage: { inputTokens: null, outputTokens: null, totalTokens: null } });
      process.exitCode = 1;
      break;
    }
  }
  const report = createEvaluationReport({ version: 1, mode: "live", transport: options.stream ? "stream" : "json", rows,
    caseHash: createHash("sha256").update(JSON.stringify(selected)).digest("hex"), promptHash: createHash("sha256").update(CONVERSATION_INSTRUCTIONS).digest("hex") });
  if (options.report) {
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(new URL(options.report, new URL("../../../../output/evaluations/", import.meta.url)), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.summary.passed !== selected.length) process.exitCode = 1;
}

main().catch(() => { process.stderr.write("Evaluation setup failed. No automatic retry.\n"); process.exitCode = 1; });
