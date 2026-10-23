import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { createApp } from "../execution-service/src/app/app.ts";
import { createDockerRunner } from "../execution-service/src/features/runs/docker.runner.ts";
import { createProjectClient } from "../execution-service/src/features/runs/project.client.ts";
import { createPreviewServer } from "../execution-service/src/features/runs/preview.server.ts";
import { createRunService, type RunService } from "../execution-service/src/features/runs/run.service.ts";
import { createCandidateChecks, createCandidateClient } from "../execution-service/src/features/runs/candidate.check.ts";

// Isolated test ports must never reuse or stop a developer's existing preview controller.
async function listen(server: Server, port: number) {
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
}

// Bound listener cleanup even when a failed browser leaves an HTTP keepalive connection.
async function close(server: Server) {
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
}

// Compose production Execution modules without replacing authorization, Docker or artifact serving.
export async function startPreviewFixture(buildGate = false) {
  const runner = await createDockerRunner(process.env.PREVIEW_RUNNER_IMAGE ?? "agentforge-preview-runner:local");
  let holdNext = false;
  let release: (() => void) | undefined;
  const evidence = { started: 0, completed: 0 };
  const checkToken = process.env.EXECUTION_CHECK_TOKEN;
  if (buildGate && !checkToken) throw new Error("Gated fixture requires its test-only service credential.");
  const checks = buildGate && checkToken ? createCandidateChecks({ ...runner,
    // Hold only the TEST candidate boundary; actual admission/build/cleanup still use the shared real runner.
    async build(input) {
      evidence.started++;
      if (holdNext) {
        holdNext = false;
        await new Promise<void>((resolve) => { release = resolve; });
        release = undefined;
      }
      const artifacts = await runner.build(input);
      evidence.completed++;
      return artifacts;
    },
  }, createCandidateClient("http://127.0.0.1:4311", checkToken)) : undefined;
  let service: RunService;
  const preview = createPreviewServer({ artifact: (...args) => service.artifact(...args) }, "http://localhost:3102");
  service = createRunService(runner, "http://127.0.0.1:5311");
  const app = createApp({ service, projects: createProjectClient("http://127.0.0.1:4311") },
    checks && checkToken ? { checks, token: checkToken } : undefined);
  const api = createServer((request, response) => {
    response.setHeader("x-agentforge-test-fixture", "agentforge-real-preview-v1");
    app(request, response);
  });
  try {
    await listen(preview, 5311);
    await listen(api, 5310);
  } catch (error) {
    release?.();
    await Promise.all([service.close(), checks?.close()]);
    await Promise.all([close(api), close(preview)]);
    throw error;
  }
  // Await runner cancellation/container removal before fixture records are cleaned up.
  return {
    // A deterministic barrier proves unpublished pending state without guessing Docker timings.
    holdNextCheck() {
      if (!checks || holdNext || release) throw new Error("Candidate barrier unavailable.");
      holdNext = true;
    },
    // Teardown also releases a held candidate so a failed browser cannot strand a worker.
    releaseCheck() { release?.(); },
    // Only counters are exposed to the test API, never owner credentials or source.
    checkEvidence() { return { ...evidence, held: !!release }; },
    // Cancel checks and await real container cleanup before the fixture removes records.
    async stop() {
      release?.();
      await Promise.all([service.close(), checks?.close()]);
      await Promise.all([close(api), close(preview)]);
    },
  };
}
