import type { ErrorRequestHandler, RequestHandler } from "express";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ message: "Route not found." });
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }

  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    res.status(400).json({ message: "Request body contains invalid JSON." });
    return;
  }

  res.status(500).json({ message: "Internal server error." });
};
