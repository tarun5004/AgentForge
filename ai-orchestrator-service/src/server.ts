import { createApp } from "./app.js";
import { env } from "./config/env.js";

const server = createApp().listen(env.PORT, () => {
  process.stdout.write(
    `${JSON.stringify({
      level: "info",
      service: "ai-orchestrator-service",
      message: "server_started",
      port: env.PORT,
      model: env.AI_MODEL,
    })}\n`,
  );
});

function shutdown(signal: string): void {
  process.stdout.write(
    `${JSON.stringify({
      level: "info",
      service: "ai-orchestrator-service",
      message: "shutdown",
      signal,
    })}\n`,
  );

  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
