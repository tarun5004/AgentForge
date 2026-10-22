import dotenv from "dotenv";
import { parseSmokeOptions, runGenerationSmoke, SmokeError } from "./generation-smoke.js";

// Keep dry-run credential-free; only an explicitly approved execution loads the local service env.
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write("smoke:generation [--url http://127.0.0.1:6001] [--execute --allow-paid]\nDefault: no network. Execution sends one generation POST, not a guaranteed single provider attempt or dollar cap.\n");
    return;
  }
  const options = parseSmokeOptions(args);
  if (options.execute) dotenv.config({ quiet: true });
  const report = await runGenerationSmoke(options, options.execute ? process.env.INTERNAL_SERVICE_TOKEN : undefined);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

// Never echo raw HTTP bodies, credentials, user prompts or generated source on failure.
main().catch((error: unknown) => {
  const code = error instanceof SmokeError ? error.code : "SMOKE_CHECK_FAILED";
  process.stderr.write(`${JSON.stringify({ code, notice: "No automatic retry. If a generation was submitted, inspect service/Gateway logs before retrying; it may still run or incur cost." })}\n`);
  process.exitCode = 1;
});
