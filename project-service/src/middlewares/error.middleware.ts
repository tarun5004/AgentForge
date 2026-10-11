import type { ErrorRequestHandler, RequestHandler } from "express";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    public readonly generationId?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ message: "Route not found." });
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  // Express rejects large JSON before the controller. Preserve 413 instead of mislabelling it 500.
  if (error?.type === "entity.too.large" && error.status === 413) {
    res.status(413).json({ message: "Request body is too large.", code: "REQUEST_TOO_LARGE" });
    return;
  }
  if (error instanceof AppError) {
    // Preserve old {message} errors; new retry codes let clients distinguish conflict from uncertainty.
    res.status(error.statusCode).json({
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.generationId ? { generationId: error.generationId } : {}),
    });
    return;
  }

  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    res.status(400).json({ message: "Request body contains invalid JSON." });
    return;
  }

  res.status(500).json({ message: "Internal server error." });
};
