import { createApp } from "./app/app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { createDockerRunner } from "./features/runs/docker.runner.js";
import { createProjectClient } from "./features/runs/project.client.js";
import { createRunService } from "./features/runs/run.service.js";
import { createPreviewServer } from "./features/runs/preview.server.js";
import { stopExecution } from "./shutdown.js";

const service = env.LOCAL_PREVIEW_ENABLED
  ? createRunService(await createDockerRunner(env.PREVIEW_RUNNER_IMAGE), `http://127.0.0.1:${env.PREVIEW_PORT}`)
  : undefined;
const previewServer = service ? createPreviewServer(service, env.PREVIEW_FRONTEND_ORIGIN) : undefined;
previewServer?.listen(env.PREVIEW_PORT, "127.0.0.1");
const app = createApp(service ? { service, projects: createProjectClient(env.PROJECT_SERVICE_URL) } : undefined);
// Docker control stays loopback-only; the existing unprivileged status container remains unchanged.
const server = app.listen(env.PORT, service ? "127.0.0.1" : "0.0.0.0", () => {
  logger.info({ port: env.PORT }, "Execution service listening");
});

// Cancel builds and wait for container removal on an orderly shutdown.
let stopping = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "Execution service shutting down");

  const forceShutdownTimer = setTimeout(() => {
    logger.error("Execution service shutdown timed out");
    process.exit(1);
  }, 45_000);
  forceShutdownTimer.unref();

  try {
    await stopExecution(server, previewServer, () => service?.close() ?? Promise.resolve());
    logger.info("Execution service stopped");
  } catch {
    logger.error("Execution service shutdown failed");
    process.exitCode = 1;
  } finally {
    clearTimeout(forceShutdownTimer);
  }
}

// Binding failures must terminate instead of leaving a half-started local controller.
function listenError() {
  logger.error("Execution listener could not bind; check the configured local ports.");
  process.exitCode = 1;
  void shutdown("SIGTERM");
}
server.once("error", listenError);
previewServer?.once("error", listenError);

process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
