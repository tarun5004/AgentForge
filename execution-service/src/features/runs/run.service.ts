import { randomBytes, randomUUID } from "node:crypto";
import type { Artifacts } from "./run.artifacts.js";
import type { Runner } from "./docker.runner.js";
import { RunError, RunBuildError, RunCleanupError } from "./run.errors.js";
import type { Revision } from "./run.schema.js";

const IDLE_MS = 30 * 60_000;
const MAX_LIFETIME_MS = 60 * 60_000;
type State = "building" | "cancelling" | "ready" | "failed" | "cancelled" | "expired";
type Run = {
  id: string; projectId: string; revisionId: string; state: State; token: string;
  createdAt: number; lastActiveAt: number; message: string; artifacts: Artifacts;
  errorCode: "BUILD_FAILED" | "CLEANUP_UNCONFIRMED" | null;
  abort: AbortController; task: Promise<void>;
};

// Keep the local MVP bounded and explicit: one build, eight cached runs, no durable-job claim.
export function createRunService(runner: Runner, previewOrigin: string, now = Date.now) {
  const runs = new Map<string, Run>();
  let closed = false;
  let building = false;

  // Polling does not extend lifetime; only authenticated user activity should keep a preview alive.
  function expire() {
    for (const run of runs.values()) {
      if (run.state === "ready" && (now() - run.lastActiveAt >= IDLE_MS || now() - run.createdAt >= MAX_LIFETIME_MS)) {
        run.state = "expired";
        run.artifacts.clear();
        run.message = "Preview expired. Start a new run for this saved revision.";
      }
    }
  }

  // Capabilities stay out of lists/logs and are returned only after route-level owner authorization.
  function describe(run: Run) {
    expire();
    return { id: run.id, projectId: run.projectId, revisionId: run.revisionId, state: run.state,
      message: run.message, errorCode: run.errorCode, createdAt: new Date(run.createdAt).toISOString(),
      previewUrl: run.state === "ready" ? `${previewOrigin}/preview/${run.id}/${run.token}/` : null };
  }

  // Unknown or evicted IDs disclose no project information.
  function find(id: string): Run {
    expire();
    const run = runs.get(id);
    if (!run) throw new RunError(404, "RUN_NOT_FOUND", "Run not found.");
    return run;
  }

  const timer = setInterval(expire, 30_000);
  timer.unref();
  return {
    find, describe,
    // Synchronous admission prevents concurrent requests from starting multiple expensive builds.
    start(revision: Revision) {
      expire();
      if (closed) throw new RunError(503, "STOPPING", "Execution Service is stopping.");
      for (const run of runs.values()) {
        if (run.projectId === revision.projectId && run.revisionId === revision.id && ["building", "ready"].includes(run.state)) {
          return describe(run);
        }
      }
      if (building) {
        throw new RunError(429, "BUILD_BUSY", "One local build is already running. Try again after it finishes.");
      }
      if (runs.size >= 8) {
        const oldest = runs.keys().next().value;
        if (oldest) runs.delete(oldest);
      }
      const run: Run = { id: randomUUID(), projectId: revision.projectId, revisionId: revision.id,
        state: "building", token: randomBytes(24).toString("hex"), createdAt: now(), lastActiveAt: now(),
        message: "Building the saved revision in a restricted container.", artifacts: new Map(),
        errorCode: null,
        abort: new AbortController(), task: Promise.resolve() };
      runs.set(run.id, run);
      building = true;
      run.task = (async () => {
        try {
          const artifacts = await runner.build({ id: run.id, revision, previewPath: `/preview/${run.id}/${run.token}`, signal: run.abort.signal });
          if (run.abort.signal.aborted) {
            run.state = "cancelled";
            run.message = "Preview stopped. Build cleanup completed.";
            return;
          }
          run.artifacts = artifacts;
          run.state = "ready";
          run.lastActiveAt = now();
          run.message = "Static Next.js build passed. Build container removed.";
        } catch (error) {
          if (error instanceof RunCleanupError) {
            run.state = "failed";
            run.errorCode = "CLEANUP_UNCONFIRMED";
            run.message = "Container cleanup is unconfirmed. Operator review is required before another build.";
          } else if (run.abort.signal.aborted) {
            run.state = "cancelled";
            run.message = "Preview stopped. Build cleanup completed.";
          } else {
            run.state = "failed";
            run.errorCode = "BUILD_FAILED";
            run.message = error instanceof RunBuildError ? error.message
              : "Build failed. Check template compatibility and the local Docker setup.";
          }
        } finally {
          building = false;
        }
      })();
      return describe(run);
    },
    // Stop is idempotent; abort triggers runner finally cleanup before its task settles.
    cancel(run: Run) {
      if (run.errorCode === "CLEANUP_UNCONFIRMED") return describe(run);
      const inProgress = run.state === "building" || run.state === "cancelling";
      run.abort.abort();
      run.artifacts.clear();
      run.state = inProgress ? "cancelling" : "cancelled";
      run.message = inProgress ? "Cancellation requested; waiting for container cleanup." : "Preview stopped.";
      return describe(run);
    },
    // A short-lived authenticated activity call keeps viewing distinct from background polling.
    touch(run: Run) {
      expire();
      if (run.state === "ready") run.lastActiveAt = now();
      return describe(run);
    },
    // Static bytes are accessible only with the unguessable, expiring preview capability.
    artifact(id: string, token: string, path: string) {
      const run = find(id);
      if (run.state !== "ready" || token !== run.token) throw new RunError(404, "PREVIEW_NOT_FOUND", "Preview not found.");
      return run.artifacts.get(path);
    },
    // Shutdown waits for cleanup, rather than abandoning active container commands.
    async close() {
      closed = true;
      clearInterval(timer);
      for (const run of runs.values()) run.abort.abort();
      await Promise.all([...runs.values()].map((run) => run.task));
      runs.clear();
    },
  };
}

export type RunService = ReturnType<typeof createRunService>;
