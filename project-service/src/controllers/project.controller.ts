import type { NextFunction, Request, Response } from "express";

import { AppError } from "../middlewares/error.middleware.js";
import {
  createProject,
  getProject,
  getRevision,
  listProjects,
  listRevisions,
} from "../services/project.service.js";
import { createGeneration, getGeneration } from "../services/generation.service.js";

export async function getGenerationController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new AppError(401, "Authentication required.");
    const generation = await getGeneration(req.user.id, req.params.projectId, req.params.generationId, req.query);
    res.status(200).json({ generation });
  } catch (error) {
    next(error);
  }
}

export async function listProjectsController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new AppError(401, "Authentication required.");
    res.status(200).json(await listProjects(req.user.id, req.query));
  } catch (error) {
    next(error);
  }
}

export async function getProjectController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new AppError(401, "Authentication required.");
    const project = await getProject(req.user.id, req.params.projectId, req.query);
    res.status(200).json({ project });
  } catch (error) {
    next(error);
  }
}

export async function listRevisionsController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new AppError(401, "Authentication required.");
    res.status(200).json(await listRevisions(req.user.id, req.params.projectId, req.query));
  } catch (error) {
    next(error);
  }
}

export async function getRevisionController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new AppError(401, "Authentication required.");
    const revision = await getRevision(req.user.id, req.params.projectId, req.params.revisionId, req.query);
    res.status(200).json({ revision });
  } catch (error) {
    next(error);
  }
}

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
      req.body,
      req.header("authorization") ?? "",
    );

    res.status(generation.status === "pending" ? 202 : 201).json({ generation });
  } catch (error) {
    next(error);
  }
}
