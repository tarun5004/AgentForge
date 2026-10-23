import type { RequestHandler } from "express";

import { requirementRequestSchema } from "./requirement.schema.js";
import { assessRequirements } from "./requirement.service.js";

// Keep HTTP validation separate from assessment; injection is for isolated route tests/composition.
export function createRequirementController(assess: typeof assessRequirements): RequestHandler {
  return async (req, res, next) => {
    try {
      const request = requirementRequestSchema.parse(req.body);
      const assessment = await assess(request);
      res.status(200).json({ assessment });
    } catch (error) {
      next(error);
    }
  };
}
