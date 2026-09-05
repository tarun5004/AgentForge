import { createApp } from "./app/app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "Execution service listening");
});

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, "Execution service shutting down");

  const forceShutdownTimer = setTimeout(() => {
    logger.error("Execution service shutdown timed out");
    process.exit(1);
  }, 10_000);
  forceShutdownTimer.unref();

  server.close((error) => {
    clearTimeout(forceShutdownTimer);

    if (error) {
      logger.error({ err: error }, "Execution service shutdown failed");
      process.exitCode = 1;
      return;
    }

    logger.info("Execution service stopped");
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
