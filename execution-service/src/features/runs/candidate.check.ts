import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { Runner } from "./docker.runner.js";
import { readJson } from "./project.client.js";
import { RunBuildError, RunCleanupError, RunError } from "./run.errors.js";
import { revisionSchema, validateRevision } from "./run.schema.js";

const id = z.string().regex(/^[a-f0-9]{24}$/);
export const checkInputSchema = z.strictObject({
  projectId: id, generationId: id, snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
});
type CheckInput = z.infer<typeof checkInputSchema>;
export type BuildVerification = {
  status: "build_passed"; policyVersion: "next-static-build-v1"; snapshotHash: string;
  runnerImageId: string; checkId: string; completedAt: string;
};

// Sort paths without locale rules; both services hash the same exact UTF-8 file contents.
export function candidateHash(files: { path: string; content: string }[]): string {
  const canonical = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    .map(({ path, content }) => ({ path, content }));
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

// Separate service identity from user identity; neither credential is accepted in a request body.
export function checkServiceToken(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string" || actual.length > 256) return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Fetch only the stored owned candidate, never arbitrary browser-supplied source or URLs.
export function createCandidateClient(projectOrigin: string, serviceToken: string) {
  return async (input: CheckInput, authorization: string) => {
    try {
      const response = await fetch(`${projectOrigin}/internal/projects/${input.projectId}/generations/${input.generationId}/candidate`, {
        headers: { authorization, "x-execution-check-token": serviceToken }, redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) await response.body?.cancel();
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        throw new RunError(404, "CANDIDATE_NOT_FOUND", "Owned candidate not available.");
      }
      if (!response.ok) throw new Error();
      const body = await readJson(response) as { candidate?: { projectId?: string; generationId?: string; snapshotHash?: string; files?: unknown } };
      const candidate = body.candidate;
      if (candidate?.projectId !== input.projectId || candidate.generationId !== input.generationId || candidate.snapshotHash !== input.snapshotHash) throw new Error();
      const revision = revisionSchema.parse({ id: input.generationId, projectId: input.projectId, files: candidate.files });
      if (candidateHash(revision.files) !== input.snapshotHash) throw new RunError(422, "CANDIDATE_INVALID", "Candidate identity or source policy did not match.");
      // Verified source can still be unsupported (for example no app/page.tsx); repeating transport cannot fix it.
      try { return validateRevision(revision); }
      catch { throw new RunError(422, "CANDIDATE_UNSUPPORTED", "Candidate is not supported by the static frontend template."); }
    } catch (error) {
      if (error instanceof RunError) throw error;
      throw new RunError(503, "CANDIDATE_UNAVAILABLE", "Candidate could not be verified with Project Service.");
    }
  };
}

// In-process deduplication only: restart may repeat a build, but never a model request.
export function createCandidateChecks(runner: Runner, load: ReturnType<typeof createCandidateClient>) {
  const imageId = runner.imageId;
  if (!imageId || !/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("Candidate checks require a pinned runner image.");
  const checks = new Map<string, { task: Promise<BuildVerification>; done: boolean }>();
  const abort = new AbortController();
  let closed = false;
  return {
    // Reauthorize BEFORE returning cached evidence; possession of a check key is not ownership.
    async check(input: CheckInput, authorization: string): Promise<BuildVerification> {
      if (closed) throw new RunError(503, "STOPPING", "Execution Service is stopping.");
      const revision = await load(input, authorization);
      if (closed) throw new RunError(503, "STOPPING", "Execution Service is stopping.");
      const key = `${input.projectId}:${input.generationId}:${input.snapshotHash}`;
      const existing = checks.get(key);
      if (existing) return existing.task;
      if (checks.size >= 8) {
        const finished = [...checks].find(([, entry]) => entry.done);
        if (!finished) throw new RunError(429, "BUILD_BUSY", "Local check capacity is occupied.");
        checks.delete(finished[0]);
      }
      const checkId = randomUUID();
      // finally runs in a promise continuation, after the entry has been registered.
      const task: Promise<BuildVerification> = (async () => {
        try {
          // Static artifacts are validated then discarded; an unpublished candidate gets no preview capability.
          await runner.build({ id: checkId, revision, previewPath: `/preview/${checkId}/${randomBytes(24).toString("hex")}`, signal: abort.signal });
          abort.signal.throwIfAborted();
          return { status: "build_passed", policyVersion: "next-static-build-v1", snapshotHash: input.snapshotHash,
            runnerImageId: imageId, checkId, completedAt: new Date().toISOString() };
        } catch (error) {
          if (error instanceof RunError) throw error;
          if (error instanceof RunCleanupError) throw new RunError(503, "CLEANUP_UNCONFIRMED", "Build container cleanup needs operator review.");
          if (error instanceof RunBuildError && error.stage === "compile" && error.reason === "command_failed") {
            throw new RunError(422, "BUILD_VERIFICATION_FAILED", error.message);
          }
          throw new RunError(503, "BUILD_CHECK_UNAVAILABLE", "Build verification is not confirmed. Retry the same saved attempt.");
        }
      })();
      const entry = { task: task.finally(() => { entry.done = true; }), done: false };
      checks.set(key, entry);
      try { return await entry.task; }
      catch (error) {
        // Uncertain/operator failures can be explicitly retried; deterministic failure remains cached.
        if (!(error instanceof RunError) || error.statusCode !== 422) checks.delete(key);
        throw error;
      }
    },
    // Stop active builds and wait for their finally-cleanup before releasing the controller.
    async close() {
      closed = true; abort.abort();
      await Promise.allSettled([...checks.values()].map((entry) => entry.task));
      checks.clear();
    },
  };
}
export type CandidateChecks = ReturnType<typeof createCandidateChecks>;

// This endpoint is server-to-server only, protected by BOTH a service secret and an owner JWT.
export function createCheckRouter(checks: CandidateChecks, serviceToken: string) {
  const router = Router();
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!checkServiceToken(req.headers["x-execution-check-token"], serviceToken)) throw new RunError(403, "FORBIDDEN", "Trusted service authentication required.");
    if (!/^Bearer [A-Za-z0-9._~-]{1,4096}$/.test(req.headers.authorization ?? "")) throw new RunError(401, "UNAUTHORIZED", "Owner access token required.");
    next();
  });
  router.post("/", async (req, res) => {
    const input = checkInputSchema.parse(req.body);
    const buildVerification = await checks.check(input, req.headers.authorization!);
    res.json({ buildVerification });
  });
  return router;
}
