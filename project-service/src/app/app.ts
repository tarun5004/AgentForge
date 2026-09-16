import express from "express";
import morgan from "morgan";

import { errorHandler, notFoundHandler } from "../middlewares/error.middleware.js";
import router from "./index.routes.js";

export function createApp() {
  const app = express();

  app.use(morgan("dev"));
  app.use(express.json({ limit: "16kb" }));

  app.get("/_status/healthz", (_req, res) => {
    res.status(200).json({ ok: true, service: "project-service" });
  });

  app.get("/_status/readyz", (_req, res) => {
    res.status(200).json({ ok: true, service: "project-service" });
  });

  app.use("/api/projects", router);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
