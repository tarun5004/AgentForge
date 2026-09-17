import express from "express";
import morgan from "morgan";

import { createGenerationController } from "./features/generations/generation.controller.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware.js";
import { requireInternalToken } from "./middlewares/internal-auth.middleware.js";

export function createApp() {
  const app = express();

  app.use(morgan("dev"));
  app.use(express.json({ limit: "256kb" }));

  app.get("/_status/healthz", (_req, res) => {
    res.status(200).json({ ok: true, service: "ai-orchestrator-service" });
  });

  app.post(
    "/internal/generations",
    requireInternalToken,
    createGenerationController,
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
