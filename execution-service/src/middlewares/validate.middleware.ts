import type { RequestHandler } from "express";
import type { ZodType } from "zod";

export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Invalid request body",
        issues: result.error.issues.map((issue) => ({
          field: issue.path.join(".") || "body",
          message: issue.message,
        })),
        requestId: req.id,
      });

      return;
    }

    req.body = result.data;
    next();
  };
}