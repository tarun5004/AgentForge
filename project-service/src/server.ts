import { createApp } from "./app/app.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { env } from "./config/env.js";

async function startServer(): Promise<void> {
  await connectDatabase();

  const server = createApp().listen(env.PORT);

  async function shutdown(signal: string): Promise<void> {
    process.stdout.write(
      `${JSON.stringify({ level: "info", service: "project-service", message: "shutdown", signal })}\n`,
    );

    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void startServer().catch(() => {
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      service: "project-service",
      message: "startup_failed",
    })}\n`,
  );
  process.exit(1);
});
