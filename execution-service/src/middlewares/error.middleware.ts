import type { ErrorRequestHandler, RequestHandler } from "express";

import { logger } from "../config/logger.js";

export const notFoundMiddleware: RequestHandler = (req, res) => {
  res.status(404).json({
    code: "NOT_FOUND",
    message: "Route not found",
    requestId: req.id,
  });
};

export const errorMiddleware: ErrorRequestHandler = (error, req, res, _next) => {
  logger.error(
    {
      err: error,
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
