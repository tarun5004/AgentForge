import type { NextFunction, Request, Response } from "express";

import { AppError } from "../middlewares/error.middleware.js";
import { createProject } from "../services/project.service.js";
import { createGeneration } from "../services/generation.service.js";

export async function createProjectController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, "Authentication required.");
    }

    const project = await createProject(req.user.id, req.body);
    res.status(201).json({ project });
  } catch (error) {
    next(error);
  }
}

export async function createGenerationController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, "Authentication required.");
    }

    const projectId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0] ?? ""
      : req.params.projectId ?? "";
    const generation = await createGeneration(
      req.user.id,
      projectId,
      req.header("idempotency-key"),
    );

    res.status(201).json({ generation });
  } catch (error) {
    next(error);
  }
}
