import { createServer, type Server } from "node:http";
import { createServer as createPortProbe } from "node:net";
import { once } from "node:events";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const collections = ["users", "projects", "revisions", "generations", "projectbriefs", "conversations"];
const email = "conversation-live-owner@agentforge.test";

// A dry run cannot accidentally load credentials or start inference.
export function parseLiveOptions(args: string[]) {
  if (new Set(args).size !== args.length || args.some(arg => !["--execute", "--allow-live", "--help"].includes(arg))) {
    throw new Error("Use --execute --allow-live, or no arguments for a dry run.");
  }
  if (args.includes("--help") && args.length !== 1) throw new Error("Use --help separately.");
  if (args.includes("--execute") !== args.includes("--allow-live")) throw new Error("Live execution needs both --execute and --allow-live.");
  return { execute: args.includes("--execute"), help: args.includes("--help") };
}

// Never derive a cleanup target from the application's normal database settings.
export function validateLiveDatabase(value: string | undefined) {
  if (!value) throw new Error("Set AGENTFORGE_TEST_MONGODB_URI to an empty dedicated local agentforge_test_* database.");
  const target = new URL(value);
  if (target.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(target.hostname) ||
      !/^\/agentforge_test_[a-zA-Z0-9_]+$/.test(target.pathname) || target.username || target.password || target.search || target.hash) {
    throw new Error("Only a dedicated local test database without credentials/options is allowed.");
  }
  return target.pathname.slice(1);
}

type ProviderCall = { index: number; outputCap: number; reservedUsd?: number; status?: number; usage?: unknown; failed?: boolean; networkError?: { name: string; code: string | null; aborted: boolean } };

// Pricing is deliberately explicit: a different model needs a fresh price review, not a guessed estimate.
export function liveModelPricing(model: string) {
  if (model !== "gemini-3.5-flash-lite") throw new Error("Live verification pricing is reviewed only for gemini-3.5-flash-lite; no model was changed.");
  return { inputUsdPerMillion: 0.30, outputUsdPerMillion: 2.50, source: "https://ai.google.dev/gemini-api/docs/pricing", ceilingUsd: 0.60 };
}

// The actual network boundary enforces the budget; test scripts cannot silently choose another provider.
export function guardLiveProvider(fetcher: typeof fetch, model: string, calls: ProviderCall[], ceilingUsd = 0.60) {
  const pricing = liveModelPricing(model);
  if (!Number.isFinite(ceilingUsd) || ceilingUsd <= 0 || ceilingUsd > pricing.ceilingUsd) throw new Error("Invalid live-test reservation ceiling.");
  let halted = false;
  let reservedUsd = 0;
  const fingerprints = new Set<string>();
  const guarded: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (["localhost", "127.0.0.1"].includes(url.hostname)) return fetcher(input, init);
    let payload: { generationConfig?: { maxOutputTokens?: number } };
    const body = typeof init?.body === "string" ? init.body : "";
    try { payload = JSON.parse(body); } catch { halted = true; throw new Error("Live admission rejected non-JSON provider input."); }
    const outputCap = payload.generationConfig?.maxOutputTokens;
    const fingerprint = createHash("sha256").update(body).digest("hex");
    if (halted || url.origin !== "https://generativelanguage.googleapis.com" ||
        url.pathname !== `/v1beta/models/${model}:generateContent` || (init?.method ?? "GET").toUpperCase() !== "POST" ||
        calls.length >= 10 || Buffer.byteLength(body) > 100_000 || fingerprints.has(fingerprint) ||
        !Number.isSafeInteger(outputCap) || outputCap! <= 0 || outputCap! > 8_000) {
      halted = true;
      throw new Error("Live provider admission guard stopped further inference.");
    }
    // UTF-8 bytes conservatively stand in for input tokens; overhead and maximum output are reserved before sending.
    const reservation = ((Buffer.byteLength(body) + 2_048) * pricing.inputUsdPerMillion + outputCap! * pricing.outputUsdPerMillion) / 1_000_000;
    if (reservedUsd + reservation > ceilingUsd) {
      halted = true;
      throw new Error("Conservative live-test spend reservation exceeded; no request was sent.");
    }
    reservedUsd += reservation;
    fingerprints.add(fingerprint);
    const call: ProviderCall = { index: calls.length + 1, outputCap: outputCap!, reservedUsd: reservation };
    calls.push(call);
    try {
      const response = await fetcher(input, init);
      call.status = response.status;
      const result = await response.clone().json() as { usageMetadata?: unknown };
      call.usage = result.usageMetadata ?? null;
      if (!response.ok) { halted = true; call.failed = true; }
      return response;
    } catch (error) {
      halted = true; call.failed = true;
      // Names/codes identify DNS, connection and abort failures without logging URLs, keys or bodies.
      const failure = error as { name?: unknown; cause?: { code?: unknown } };
      const code = failure?.cause?.code;
      call.networkError = {
        name: typeof failure?.name === "string" && /^[A-Za-z_]{1,60}$/.test(failure.name) ? failure.name : "UnknownError",
        code: typeof code === "string" && /^[A-Z0-9_]{1,60}$/.test(code) ? code : null,
        aborted: init?.signal?.aborted ?? false,
      };
      throw new Error("Live provider request failed; no automatic retry is permitted.");
    }
  };
  // Keep the closed guard installed during teardown: an in-flight tool loop must not bypass the budget.
  return Object.assign(guarded, { stop: () => { halted = true; } });
}

// Retain an actionable CLI error without copying page code, tokens, passwords or response bodies.
export function safeBrowserError(output: string) {
  const line = output.split(/\r?\n/).find(value => /^(?:Error|TimeoutError|TypeError|ReferenceError|SyntaxError):/.test(value.trim()));
  if (!line) return "Browser command failed; no safe error line was returned.";
  return line.trim().slice(0, 300)
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(?:AIza|AQ\.)[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(?:password|api[_-]?key|token)\s*[=:]\s*\S+/gi, "credential=[REDACTED]");
}

// Only the result block is parsed; the CLI also prints source code containing unrelated JSON text.
export function browserOutcome(output: string) {
  const result = output.match(/### Result\s*\r?\n([\s\S]*?)(?=\r?\n### |$)/)?.[1]?.trim();
  if (!result) throw new Error("Browser command returned no outcome.");
  const value = JSON.parse(result) as { passed?: boolean; checkpoint?: string; failure?: string };
  if (typeof value.passed !== "boolean") throw new Error("Browser command returned an invalid outcome.");
  return value;
}

// Refuse occupied ports instead of replacing a student's existing app.
async function assertFreePort(port: number) {
  const probe = createPortProbe();
  probe.listen(port, "127.0.0.1");
  try { await once(probe, "listening"); }
  catch { throw new Error(`Verification port ${port} is occupied; existing processes were left untouched.`); }
  await new Promise<void>(done => probe.close(() => done()));
}

// Readiness is actual HTTP evidence, not a guessed startup sleep.
async function waitReady(url: string, child?: ChildProcess) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error("Owned frontend exited before readiness.");
    try { if ((await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok) return; } catch { /* Startup may still be compiling. */ }
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error("Verification readiness timed out.");
}

// CLI output may contain page details; retain only success/failure here and write explicit safe evidence separately.
async function command(binary: string, args: string[], timeout = 30_000) {
  const child = spawn(binary, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", chunk => { output += String(chunk); });
  child.stderr.on("data", chunk => { output += String(chunk); });
  const timer = setTimeout(() => child.kill(), timeout);
  try {
    const [code] = await once(child, "exit");
    if (code !== 0 || output.includes("### Error")) throw new Error(safeBrowserError(output));
    return output;
  } finally { clearTimeout(timer); }
}

// The existing pinned CLI is reused rather than adding a browser dependency to the app.
async function resolveBrowserCli() {
  if (process.env.AGENTFORGE_PLAYWRIGHT_CLI) return resolve(process.env.AGENTFORGE_PLAYWRIGHT_CLI);
  const npx = resolve(dirname(process.execPath), "node_modules/npm/bin/npx-cli.js");
  const output = await command(process.execPath, [npx, "--yes", "--package", "@playwright/cli@0.1.22", "--", "where.exe", "playwright-cli"], 90_000);
  const shim = output.split(/\r?\n/).find(line => line.trim().endsWith("playwright-cli.cmd"))?.trim();
  if (!shim) throw new Error("Pinned browser CLI was not found.");
  const directory = resolve(dirname(shim), "../@playwright/cli");
  const metadata = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  if (metadata.version !== "0.1.22") throw new Error("Unexpected browser CLI version.");
  return resolve(directory, typeof metadata.bin === "string" ? metadata.bin : metadata.bin["playwright-cli"]);
}

// Only an explicitly opted-in run reads the ignored provider secret and creates disposable records.
export async function runLiveVerification() {
  const database = validateLiveDatabase(process.env.AGENTFORGE_TEST_MONGODB_URI);
  if (process.platform !== "win32") throw new Error("This local browser launcher currently requires Windows.");
  for (const port of [3102, 4310, 4311, 4312, 5310, 5311]) await assertFreePort(port);
  const { default: dotenv } = await import("dotenv");
  const { default: mongoose } = await import("mongoose");
  let saved: Record<string, string>;
  try { saved = dotenv.parse(await readFile(resolve(root, "ai-orchestrator-service/.env"))); }
  catch { throw new Error("The ignored AI-service .env could not be read; configure it locally before live execution."); }
  if (saved.AI_PROVIDER !== "google" || !saved.GOOGLE_GENERATIVE_AI_API_KEY || !/^gemini-[\w.:-]+$/.test(saved.AI_MODEL ?? "")) {
    throw new Error("Configure direct Google and its model in the ignored AI-service env first.");
  }
  const pricing = liveModelPricing(saved.AI_MODEL);
  const image = process.env.PREVIEW_RUNNER_IMAGE ?? "agentforge-preview-runner:gemini-live-check";
  const calls: ProviderCall[] = [];
  const report: Record<string, unknown> = { model: saved.AI_MODEL, database, calls, passed: false, cleanup: false,
    notice: "Real Google inference. Ten provider requests maximum and $0.60 conservative reservations. Estimates assume one input token per UTF-8 byte plus overhead and maximum output; not a billing receipt or hard provider-account dollar guarantee. No paid fallback or automatic repair.",
    pricing,
    boundaries: { auth: "real", project: "real", ai: "real-google", mongo: "dedicated-test-db", execution: "real-docker", browser: "real" } };
  // Presence-only diagnostics never include values, fingerprints or secret lengths.
  report.configuration = { provider: "google", googleCredentialPresent: true, gatewayFallback: false, retrievalMode: "lexical", envSource: "ignored-ai-service-file" };
  const servers: Server[] = [];
  let next: ChildProcess | undefined;
  let preview: Awaited<ReturnType<typeof import("../tests/frontend-preview.fixture.mts").startPreviewFixture>> | undefined;
  let browserCli: string | undefined;
  const session = `conversation-live-${process.pid}`;
  const artifact = resolve(root, "output/playwright");
  const rawFetch = globalThis.fetch;
  const guardedFetch = guardLiveProvider(rawFetch, saved.AI_MODEL, calls);
  await mkdir(artifact, { recursive: true });
  const reportPath = resolve(artifact, `conversation-live-${Date.now()}.json`);
  let admitted = false;
  try {
    await mongoose.connect(process.env.AGENTFORGE_TEST_MONGODB_URI!, { serverSelectionTimeoutMS: 5_000 });
    const db = mongoose.connection.db!;
    for (const name of collections) if (await db.collection(name).countDocuments({})) throw new Error("Dedicated live test database must initially be empty.");
    admitted = true;
    Object.assign(process.env, {
      NODE_ENV: "test", PORT: "4311", MONGODB_URI: process.env.AGENTFORGE_TEST_MONGODB_URI,
      ACCESS_TOKEN_SECRET: randomBytes(32).toString("hex"), REFRESH_TOKEN_SECRET: randomBytes(32).toString("hex"),
      ACCESS_TOKEN_EXPIRY: "30m", REFRESH_TOKEN_EXPIRY: "1h", INTERNAL_SERVICE_TOKEN: randomBytes(32).toString("hex"),
      AI_ORCHESTRATOR_URL: "http://127.0.0.1:4312", BUILD_GATE_ENABLED: "true", EXECUTION_CHECK_TOKEN: randomBytes(32).toString("hex"),
      EXECUTION_SERVICE_URL: "http://127.0.0.1:5310", PREVIEW_RUNNER_IMAGE: image,
      AI_PROVIDER: "google", AI_MODEL: saved.AI_MODEL, GOOGLE_GENERATIVE_AI_API_KEY: saved.GOOGLE_GENERATIVE_AI_API_KEY,
      AI_GATEWAY_API_KEY: "", VERCEL_OIDC_TOKEN: "", RAG_RETRIEVAL_MODE: "lexical",
    });
    globalThis.fetch = guardedFetch;
    const { createApp: authApp } = await import("../auth-service/src/app/app.ts");
    const { createApp: projectApp } = await import("../project-service/src/app/app.ts");
    const { createApp: aiApp } = await import("../ai-orchestrator-service/src/app.ts");
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    preview = await (await import("../tests/frontend-preview.fixture.mts")).startPreviewFixture(true);
    for (const [app, port] of [[authApp(), 4310], [projectApp(), 4311], [aiApp(), 4312]] as const) {
      const server = createServer(app); servers.push(server); server.listen(port, "127.0.0.1"); await once(server, "listening");
    }
    next = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3102"], {
      cwd: resolve(root, "nextjs-boilerplate"), windowsHide: true, stdio: "ignore",
      env: { ...process.env, NODE_ENV: "development", AUTH_SERVICE_URL: "http://127.0.0.1:4310", PROJECT_SERVICE_URL: "http://127.0.0.1:4311", EXECUTION_SERVICE_URL: "http://127.0.0.1:5310" },
    });
    await waitReady("http://localhost:3102/login", next);
    browserCli = await resolveBrowserCli();
    const channel = process.env.AGENTFORGE_BROWSER_CHANNEL ?? "chrome";
    if (!["chrome", "msedge", "firefox", "webkit"].includes(channel)) throw new Error("Unsupported browser channel.");
    await command(process.execPath, [browserCli, `-s=${session}`, "open", `--browser=${channel}`]);
    await command(process.execPath, [browserCli, `-s=${session}`, "resize", "1440", "1000"]);
    const outcome = browserOutcome(await command(process.execPath, [browserCli, `-s=${session}`, "run-code", "--filename=scripts/conversation-live.browser.js"], 600_000));
    report.browserOutcome = outcome;
    if (!outcome.passed) throw new Error("Browser scenario failed at its recorded checkpoint; no automatic retry.");
    report.passed = true;
    report.browser = "Greeting and planning created no projects; generated v1/v2 built, previewed, interacted, stopped and survived refresh.";
  } catch (error) {
    report.failure = error instanceof Error ? safeBrowserError(`Error: ${error.message}`) : "Verification failed.";
    throw error;
  } finally {
    guardedFetch.stop();
    // This standalone process retains the closed guard until exit, including late asynchronous model steps.
    const cleanup: string[] = [];
    if (browserCli) try { await command(process.execPath, [browserCli, `-s=${session}`, "close"]); } catch { cleanup.push("browser"); }
    if (next?.pid && next.exitCode === null) {
      const result = spawnSync("taskkill.exe", ["/PID", String(next.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      if (result.status !== 0 && next.exitCode === null) cleanup.push("frontend");
    }
    if (admitted) {
      try { await (await import("../project-service/src/services/generation.build-gate.ts")).drainCandidatePublications(); } catch { cleanup.push("candidate-worker"); }
      try { await preview?.stop(); } catch { cleanup.push("execution"); }
      for (const server of servers) { server.closeAllConnections(); if (server.listening) await new Promise<void>(done => server.close(() => done())); }
      try {
        const db = mongoose.connection.db!;
        const user = await db.collection("users").findOne({ email }, { projection: { _id: 1 } });
        if (user) {
          const projects = await db.collection("projects").find({ ownerId: user._id.toString() }, { projection: { _id: 1 } }).toArray();
          const ids = projects.map(project => project._id);
          for (const name of ["revisions", "generations", "projectbriefs"]) await db.collection(name).deleteMany({ projectId: { $in: ids } });
          await db.collection("conversations").deleteMany({ ownerId: user._id.toString() });
          await db.collection("projects").deleteMany({ _id: { $in: ids }, ownerId: user._id.toString() });
          await db.collection("users").deleteOne({ _id: user._id, email });
        }
        report.counts = Object.fromEntries(await Promise.all(collections.map(async name => [name, await db.collection(name).countDocuments({})])));
        if (Object.values(report.counts as Record<string, number>).some(count => count !== 0)) cleanup.push("database-records");
      } catch { cleanup.push("database"); }
      // Startup already refused existing preview containers, so leftovers here cannot be claimed as cleaned up.
      const containers = spawnSync("docker", ["ps", "-aq", "--filter", "label=agentforge.local-preview=true"], { windowsHide: true, timeout: 15_000, encoding: "utf8" });
      report.containerCleanup = containers.status === 0 && containers.stdout.trim() === "";
      if (!report.containerCleanup) cleanup.push("preview-containers");
    }
    await mongoose.disconnect();
    report.cleanup = admitted && cleanup.length === 0;
    report.cleanupIssues = cleanup;
    report.reservedUsd = calls.reduce((sum, call) => sum + (call.reservedUsd ?? 0), 0);
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    console.info(`Live verification report: ${reportPath}`);
    if (cleanup.length) throw new Error("Owned verification cleanup could not be confirmed; inspect the safe report.");
  }
}

// Importing this file in guard tests never runs services, reads keys or calls a model.
async function main() {
  const options = parseLiveOptions(process.argv.slice(2));
  if (!options.execute) {
    console.info("DRY RUN: no credentials read, network inference or services started. Set an empty local AGENTFORGE_TEST_MONGODB_URI, then run: npx tsx scripts/verify-conversation-live.mts --execute --allow-live. Requires Linux Docker, the trusted runner image and configured gemini-3.5-flash-lite. Maximum ten provider calls with $0.60 conservative spend reservations; estimates are not a provider-account dollar guarantee.");
    return;
  }
  await runLiveVerification();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error("Conversation verification failed. No automatic AI retry; inspect the ignored report/browser artifacts."); process.exitCode = 1; });
}
