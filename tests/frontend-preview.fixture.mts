import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { createApp } from "../execution-service/src/app/app.ts";
import { createDockerRunner } from "../execution-service/src/features/runs/docker.runner.ts";
import { createProjectClient } from "../execution-service/src/features/runs/project.client.ts";
import { createPreviewServer } from "../execution-service/src/features/runs/preview.server.ts";
import { createRunService, type RunService } from "../execution-service/src/features/runs/run.service.ts";

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
export async function startPreviewFixture() {
  const runner = await createDockerRunner("agentforge-preview-runner:local");
  let service: RunService;
  const preview = createPreviewServer({ artifact: (...args) => service.artifact(...args) }, "http://localhost:3102");
  service = createRunService(runner, "http://127.0.0.1:5311");
  const app = createApp({ service, projects: createProjectClient("http://127.0.0.1:4311") });
  const api = createServer((request, response) => {
    response.setHeader("x-agentforge-test-fixture", "agentforge-real-preview-v1");
    app(request, response);
  });
  try {
    await listen(preview, 5311);
    await listen(api, 5310);
  } catch (error) {
    await service.close();
    await Promise.all([close(api), close(preview)]);
    throw error;
  }
  // Await runner cancellation/container removal before fixture records are cleaned up.
  return async function stopPreviewFixture() {
    await service.close();
    await Promise.all([close(api), close(preview)]);
  };
}
