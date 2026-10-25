import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { generatedManifestSchema, generationRequestSchema, MANIFEST_POLICY_VERSION, validateManifest } from "../features/generations/generation.schema.js";

type SmokeOptions = { url: string; execute: boolean; allowPaid: boolean };
const RESPONSE_LIMIT = 1_048_576;
const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const smokeResponseSchema = z.strictObject({ generation: generatedManifestSchema.extend({
  requestId: z.string(), provider: z.enum(["vercel-ai-gateway", "google"]),
  model: z.string().max(200).regex(/^(?:[a-z0-9-]+\/[a-zA-Z0-9._:-]+|gemini-[a-zA-Z0-9._:-]+)$/),
  validation: z.strictObject({ policyVersion: z.literal(MANIFEST_POLICY_VERSION), status: z.literal("manifest_validated") }),
  usage: z.strictObject({ inputTokens: tokenCount, outputTokens: tokenCount, totalTokens: tokenCount }),
  latencyMs: z.number().finite().nonnegative(),
}) });

// Print stable failure codes only; provider bodies and transport errors may contain private data.
export class SmokeError extends Error {
  constructor(public code: string) { super(code); }
}

// Never forward the internal service credential to a remote host or a URL containing credentials.
function localOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new SmokeError("INVALID_LOCAL_ORIGIN"); }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || /[\s?#]/.test(value)) {
    throw new SmokeError("INVALID_LOCAL_ORIGIN");
  }
  // The repo's old 6000 default is on Fetch's unsafe-port list; Compose already uses 6001.
  if (url.port === "6000") throw new SmokeError("FETCH_BLOCKED_PORT_6000");
  return url.origin;
}

// Two explicit flags distinguish local request inspection from potentially billable generation.
export function parseSmokeOptions(args: string[]): SmokeOptions {
  const options = { url: "http://127.0.0.1:6001", execute: false, allowPaid: false };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (seen.has(flag)) throw new SmokeError("DUPLICATE_OPTION");
    seen.add(flag);
    if (flag === "--url") {
      const value = args[++index];
      if (!value) throw new SmokeError("URL_REQUIRED");
      options.url = localOrigin(value);
    } else if (flag === "--execute") options.execute = true;
    else if (flag === "--allow-paid") options.allowPaid = true;
    else throw new SmokeError("UNKNOWN_OPTION");
  }
  if (options.execute !== options.allowPaid) throw new SmokeError("BOTH_EXECUTION_FLAGS_REQUIRED");
  return options;
}

// Bound actual bytes before JSON parsing, including responses with a missing or dishonest length.
async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new SmokeError("INVALID_RESPONSE");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > RESPONSE_LIMIT) throw new SmokeError("RESPONSE_TOO_LARGE");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new SmokeError("INVALID_RESPONSE"); }
}

// Reuse the running service contract; this helper neither imports the provider nor persists a project.
export async function runGenerationSmoke(options: SmokeOptions, serviceToken?: string, fetcher: typeof fetch = fetch) {
  const origin = localOrigin(options.url);
  if (options.execute !== options.allowPaid) throw new SmokeError("BOTH_EXECUTION_FLAGS_REQUIRED");
  const request = generationRequestSchema.parse({
    requestId: randomUUID(), projectId: randomBytes(12).toString("hex"), template: "nextjs", mode: "economy",
    prompt: "Build a minimal accessible frontend smoke-test page. Prefer just app/page.tsx with an AgentForge smoke check heading and one button. No external assets or dependencies.",
  });
  if (!options.execute) {
    return { mode: "dry-run", requestValidated: true, networkRequests: 0, generationRequests: 0,
      endpoint: `${origin}/internal/generations`, template: request.template, productMode: request.mode,
      notice: "No network or provider call made. Execution requires --execute --allow-paid." };
  }
  if (!serviceToken?.trim() || /[\r\n]/.test(serviceToken)) throw new SmokeError("INTERNAL_TOKEN_REQUIRED");
  const signal = AbortSignal.timeout(100_000);
  let submitted = false;
  try {
    const health = await fetcher(`${origin}/_status/healthz`, { signal, redirect: "error" });
    if (!health.ok) { await health.body?.cancel(); throw new SmokeError("HEALTH_CHECK_FAILED"); }
    const identity = z.strictObject({ ok: z.literal(true), service: z.literal("ai-orchestrator-service") }).safeParse(await readJson(health));
    if (!identity.success) throw new SmokeError("WRONG_SERVICE");
    submitted = true;
    // One POST, no client retry. A timeout does not prove the server/provider stopped working.
    const response = await fetcher(`${origin}/internal/generations`, { method: "POST", redirect: "error", signal,
      headers: { "content-type": "application/json", "x-internal-service-token": serviceToken.trim(), "x-request-id": request.requestId },
      body: JSON.stringify(request) });
    if (!response.ok) { await response.body?.cancel(); throw new SmokeError(`HTTP_${response.status}`); }
    const parsed = smokeResponseSchema.safeParse(await readJson(response));
    if (!parsed.success || parsed.data.generation.requestId !== request.requestId) throw new SmokeError("INVALID_RESPONSE");
    const generation = parsed.data.generation;
    try { validateManifest({ summary: generation.summary, files: generation.files, deletedPaths: generation.deletedPaths }); }
    catch { throw new SmokeError("INVALID_MANIFEST"); }
    return { mode: "executed", generationRequests: 1, requestId: request.requestId, provider: generation.provider,
      model: generation.model, fileCount: generation.files.length, validation: generation.validation,
      usage: generation.usage, latencyMs: generation.latencyMs,
      notice: "Manifest only: not a build, saved revision, or preview proof. Server/provider retries and spend are not capped by this client." };
  } catch (error) {
    if (error instanceof SmokeError) throw error;
    throw new SmokeError(submitted ? "SUBMITTED_OUTCOME_UNKNOWN" : "SERVICE_UNAVAILABLE");
  }
}
