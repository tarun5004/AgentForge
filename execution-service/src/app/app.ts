import { randomUUID } from "node:crypto";

import express from "express";
import { pinoHttp } from "pino-http";

import { logger } from "../config/logger.js";
import { errorMiddleware, notFoundMiddleware } from "../middlewares/error.middleware.js";
import { createRunRouter } from "../features/runs/run.routes.js";
import { RunError } from "../features/runs/run.errors.js";
import type { ProjectClient } from "../features/runs/project.client.js";
import type { RunService } from "../features/runs/run.service.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

// Dependencies are composed at startup; tests replace transport, never production behavior.
export function createApp(preview?: { service: RunService; projects: ProjectClient }) {
  const app = express();

  app.disable("x-powered-by");
  app.use(
    pinoHttp({
      logger,
      genReqId(req, res) {
        const incomingRequestId = req.headers["x-request-id"];
        const requestId =
          typeof incomingRequestId === "string" && REQUEST_ID_PATTERN.test(incomingRequestId)
            ? incomingRequestId
            : randomUUID();

        res.setHeader("X-Request-Id", requestId);
        return requestId;
      },
    }),
  );
  app.use(express.json({ limit: "32kb" }));

  app.get("/_status/healthz", (_req, res) => {
    res.status(200).json({ ok: true, service: "execution-service" });
  });

  app.get("/_status/readyz", (_req, res) => {
    res.status(200).json({ ready: true, service: "execution-service" });
  });

  if (preview) {
    app.use("/api/runs", createRunRouter(preview.service, preview.projects));
  } else {
    app.use("/api/runs", () => {
      throw new RunError(503, "PREVIEW_DISABLED", "Local preview has not been enabled by the operator.");
    });
  }

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
