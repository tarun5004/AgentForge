import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ message: "Route not found." });
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  // Preserve the parser's size error; it is not a provider failure.
  if (error?.type === "entity.too.large" && error.status === 413) {
    res.status(413).json({ message: "Generation request is too large.", code: "CONTEXT_TOO_LARGE" });
    return;
  }
  if (error instanceof ZodError) {
    if (error.issues.some((issue) => issue.code === "custom" && issue.params?.code === "CONTEXT_TOO_LARGE")) {
      res.status(413).json({ message: "Generation context is too large.", code: "CONTEXT_TOO_LARGE" });
      return;
    }
    res.status(400).json({
      message: "Invalid generation request.",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
    return;
  }

  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    res.status(400).json({ message: "Request body contains invalid JSON." });
    return;
  }

  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      service: "ai-orchestrator-service",
      message: "generation_request_failed",
      requestId: req.header("x-request-id"),
      errorName: error instanceof Error ? error.name : "UnknownError",
    })}\n`,
  );

  res.status(502).json({ message: "AI generation failed. Please try again." });
};
