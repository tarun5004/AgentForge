import type { ErrorRequestHandler, RequestHandler } from "express";

import { logger } from "../config/logger.js";
import { ZodError } from "zod";
import { RunError } from "../features/runs/run.errors.js";

// Keep unknown routes distinguishable from failed builds.
export const notFoundMiddleware: RequestHandler = (req, res) => {
  res.status(404).json({
    code: "NOT_FOUND",
    message: "Route not found",
    requestId: req.id,
  });
};

// Expected boundary failures have stable codes; unsafe error text never reaches clients/logs.
export const errorMiddleware: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof RunError) {
    res.status(error.statusCode).json({ code: error.code, message: error.message, requestId: req.id });
    return;
  }
  if (error instanceof ZodError || error?.type === "entity.parse.failed") {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid request.", requestId: req.id });
    return;
  }
  if (error?.type === "entity.too.large") {
    res.status(413).json({ code: "BODY_TOO_LARGE", message: "Request body is too large.", requestId: req.id });
    return;
  }
  logger.error(
    {
      requestId: req.id,
      method: req.method,
      path: req.path,
    },
    "Unhandled request error",
  );

  res.status(500).json({
    code: "INTERNAL_SERVER_ERROR",
    message: "Internal server error",
    requestId: req.id,
  });
};
