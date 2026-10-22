import { createServer } from "node:http";
import { once } from "node:events";
import mongoose from "mongoose";
import { finishFixtureCleanup } from "./fixture-cleanup.mts";

// Run this ESM fixture with tsx; never fall back to .env or a normal application database.
const uri = process.env.AGENTFORGE_TEST_MONGODB_URI;
if (!uri) throw new Error("Set an explicit local agentforge_test_* database.");
const target = new URL(uri);
if (target.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(target.hostname) ||
  !/^\/agentforge_test_[a-zA-Z0-9_]+$/.test(target.pathname) || target.username || target.password || target.search) throw new Error("Unsafe test database target.");
await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
const db = mongoose.connection.db!;
for (const name of ["users", "projects", "revisions", "generations"]) {
  if (await db.collection(name).countDocuments({}) !== 0) throw new Error("Browser fixture requires an initially empty dedicated database.");
}
Object.assign(process.env, {
  NODE_ENV: "test", PORT: "4311", MONGODB_URI: uri,
  ACCESS_TOKEN_SECRET: "frontend-fixture-access-not-for-production",
  REFRESH_TOKEN_SECRET: "frontend-fixture-refresh-not-for-production",
  ACCESS_TOKEN_EXPIRY: "15m", REFRESH_TOKEN_EXPIRY: "1h",
  AI_ORCHESTRATOR_URL: "http://127.0.0.1:4312", INTERNAL_SERVICE_TOKEN: "frontend-fixture-internal",
});
const { createApp: createAuthApp } = await import("../auth-service/src/app/app.ts");
const { createApp: createProjectApp } = await import("../project-service/src/app/app.ts");
await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
const initialFiles = [
  { path: "app/page.tsx", content: "export default function Page() { return <main>Initial portfolio</main>; }" },
  { path: "app/globals.css", content: "body { color: white; }" },
  { path: "components/Old.tsx", content: "export default function Old() { return null; }" },
];
const aiRequests: { prompt: string; baseVersion: number | null; baseMatchesInitial: boolean }[] = [];
const fixtureEmail = "frontend-slice5-20261012@agentforge.test";
const fixtureEmails = [fixtureEmail, "revision-loop-other@agentforge.test"];
const fixtureId = "agentforge-real-revision-loop-v1";
let holdNextGeneration = false;
let releaseGeneration: (() => void) | undefined;

// Real Auth/Project APIs and Mongo run unchanged; only the paid AI network boundary is replaced.
const aiServer = createServer((request, response) => {
  // Deterministic test barriers replace timing guesses; they exist only in this fixture.
  if (request.method === "POST" && request.url === "/__fixture/hold-next") {
    if (holdNextGeneration || releaseGeneration) { response.writeHead(409).end(); return; }
    holdNextGeneration = true;
    response.end("armed"); return;
  }
  if (request.method === "POST" && request.url === "/__fixture/release") {
    if (!releaseGeneration) { response.writeHead(409).end(); return; }
    releaseGeneration();
    response.end("released"); return;
  }
  if (request.method === "GET" && request.url === "/__fixture") {
    // A runner checks identity and empty state before sending test credentials to any API.
    void readFixtureStatus(response);
    return;
  }
  if (request.method === "POST" && request.url === "/__fixture/shutdown") {
    response.end("cleanup starting");
    void shutdown();
    return;
  }
  if (request.method !== "POST" || request.url !== "/internal/generations" || request.headers["x-internal-service-token"] !== "frontend-fixture-internal") {
    response.writeHead(404).end(); return;
  }
  let body = "";
  request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
  request.on("end", async () => {
    try {
      const input = JSON.parse(body);
      const baseFiles = input.baseRevision?.files ?? [];
      aiRequests.push({ prompt: input.prompt, baseVersion: input.baseRevision?.version ?? null,
        baseMatchesInitial: JSON.stringify([...baseFiles].sort((a, b) => a.path.localeCompare(b.path))) ===
          JSON.stringify([...initialFiles].sort((a, b) => a.path.localeCompare(b.path))),
      });
      if (holdNextGeneration) {
        holdNextGeneration = false;
        await new Promise<void>((resolve) => { releaseGeneration = resolve; });
        releaseGeneration = undefined;
      }
      if (input.prompt.includes("slow")) await new Promise((resolve) => setTimeout(resolve, 2_000));
      const initial = !input.baseRevision;
      const files = input.prompt.includes("invalid output") ? [] : initial ? initialFiles :
        [{ path: "app/page.tsx", content: `export default function Page() { return <main>Revised portfolio ${aiRequests.length}</main>; }` }];
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ generation: {
        requestId: input.requestId, provider: "browser-test-fixture", model: "deterministic-fixture",
        summary: initial ? "Initial saved portfolio snapshot" : "Targeted saved portfolio revision",
        files, deletedPaths: !initial && input.prompt.includes("remove old") ? ["components/Old.tsx"] : [],
        validation: { policyVersion: "frontend-manifest-v1", status: "manifest_validated" },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, latencyMs: 0,
      } }));
    } catch { response.writeHead(500).end(); }
  });
}).listen(4312, "127.0.0.1");
const authApp = createAuthApp();
const projectApp = createProjectApp();
// Next must forward these markers: otherwise the runner refuses to write through its rewrites.
const authServer = createServer((request, response) => {
  response.setHeader("x-agentforge-test-fixture", fixtureId);
  authApp(request, response);
}).listen(4310, "127.0.0.1");
const projectServer = createServer((request, response) => {
  response.setHeader("x-agentforge-test-fixture", fixtureId);
  projectApp(request, response);
}).listen(4311, "127.0.0.1");
await Promise.all([once(aiServer, "listening"), once(authServer, "listening"), once(projectServer, "listening")]);
console.info("Browser fixture ready: real Auth :4310, Project :4311, deterministic AI :4312.");
console.info(`Use only test email ${fixtureEmail}; no live provider keys are required.`);

let stopping = false;
// Report only safe fixture metadata/counts, never documents, tokens or the database URI.
async function readFixtureStatus(response: import("node:http").ServerResponse) {
  try {
    const counts: Record<string, number> = {};
    for (const name of ["users", "projects", "revisions", "generations"]) counts[name] = await db.collection(name).countDocuments({});
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ fixtureId, databaseName: target.pathname.slice(1), counts, aiRequests, heldGeneration: !!releaseGeneration }));
  } catch { response.writeHead(503).end("Fixture status unavailable."); }
}
// Remove only this fixture account and its owned records; never drop the database or other data.
async function shutdown() {
  if (stopping) return;
  stopping = true;
  // A failed browser must not leave server.close waiting on a held model request forever.
  releaseGeneration?.();
  process.exitCode = await finishFixtureCleanup(async () => {
    await Promise.all([aiServer, authServer, projectServer].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    const users = await db.collection("users").find({ email: { $in: fixtureEmails } }, { projection: { _id: 1 } }).toArray();
    const ownerIds = users.map((user) => user._id.toString());
    const projects = await db.collection("projects").find({ ownerId: { $in: ownerIds } }, { projection: { _id: 1 } }).toArray();
    const projectIds = projects.map((project) => project._id);
    await db.collection("revisions").deleteMany({ projectId: { $in: projectIds } });
    await db.collection("generations").deleteMany({ projectId: { $in: projectIds } });
    await db.collection("projects").deleteMany({ _id: { $in: projectIds } });
    await db.collection("users").deleteMany({ _id: { $in: users.map((user) => user._id) } });
    const counts: Record<string, number> = {};
    for (const name of ["users", "projects", "revisions", "generations"]) counts[name] = await db.collection(name).countDocuments({});
    console.info(JSON.stringify({ fixtureCleanup: counts }));
    // Never widen deletion filters to remove someone else's unexpected records.
    if (Object.values(counts).some((count) => count !== 0)) throw new Error("Fixture data remains after scoped cleanup.");
  }, () => mongoose.disconnect());
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
