import { randomUUID } from "node:crypto";

import express from "express";
import { pinoHttp } from "pino-http";

import { logger } from "../config/logger.js";
import { errorMiddleware, notFoundMiddleware } from "../middlewares/error.middleware.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function createApp() {
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

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
