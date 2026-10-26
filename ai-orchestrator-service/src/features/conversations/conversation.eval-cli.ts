import { conversationCases, gradeConversation } from "./conversation.evaluation.js";
import { conversationRequestSchema } from "./conversation.schema.js";

// Explicit opt-in and a tiny default batch prevent accidentally running all cases against a paid model.
async function main() {
  if (!process.argv.includes("--live")) {
    process.stdout.write("No API calls made. Use --live --limit=3 (1..18), optionally --case=greeting,portfolio-plan.\n");
    process.stdout.write(`${JSON.stringify({ mode: "case-list", cases: conversationCases.map(({ id, expected }) => ({ id, expected })) }, null, 2)}\n`);
    return;
  }
  const limit = Number(process.argv.find((argument) => argument.startsWith("--limit="))?.split("=")[1] ?? "3");
  const ids = process.argv.find((argument) => argument.startsWith("--case="))?.slice(7).split(",");
  if (!Number.isInteger(limit) || limit < 1 || limit > 18 || ids?.some((id) => !conversationCases.some((item) => item.id === id))) {
    throw new Error("Invalid evaluation selection.");
  }
  const selected = conversationCases.filter(({ id }) => !ids || ids.includes(id)).slice(0, limit);
  const { respondToConversation } = await import("./conversation.service.js");
  let passed = 0;
  for (const scenario of selected) {
    try {
      const response = await respondToConversation(conversationRequestSchema.parse({ requestId: `eval-${scenario.id}`, messages: scenario.messages }));
      const grade = gradeConversation(scenario.expected, response);
      if (grade.passed) passed++;
      process.stdout.write(`${JSON.stringify({ mode: "live", id: scenario.id, expected: scenario.expected, actual: response.action, ...grade, model: response.model, usage: response.usage, retrieval: response.retrieval, latencyMs: response.latencyMs })}\n`);
    } catch {
      process.stdout.write(`${JSON.stringify({ mode: "live", id: scenario.id, passed: false, error: "Provider/output/retrieval failure; stopping without retry." })}\n`);
      process.exitCode = 1;
      return;
    }
  }
  process.stdout.write(`${JSON.stringify({ mode: "live", passed, total: selected.length, note: "Intent/contract checks only; not build, visual quality or cost verification." })}\n`);
  if (passed !== selected.length) process.exitCode = 1;
}

main().catch(() => { process.stderr.write("Evaluation setup failed. No automatic retry.\n"); process.exitCode = 1; });
