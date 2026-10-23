import type { NextFunction, Request, Response } from "express";
import { AppError } from "../middlewares/error.middleware.js";
import * as service from "../services/brief.service.js";
import { validateQueryKeys } from "../services/project-read.validation.js";

// All brief routes use JWT identity and reject query switches; no body can choose an owner.
function owner(req: Request): string {
  validateQueryKeys(req.query, []);
  if (!req.user) throw new AppError(401, "Authentication required.");
  return req.user.id;
}
// Confirmation/abandon/generation take identity from the URL, never editable model output or prompt text.
function emptyBody(req: Request): void {
  if (req.body !== undefined && (!req.body || Array.isArray(req.body) || typeof req.body !== "object" || Object.keys(req.body).length)) {
    throw new AppError(400, "This action accepts no request fields.");
  }
}
// Fetch only the current saved state; reading does not resume model work.
export async function getBrief(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ brief: await service.getBrief(owner(req), req.params.projectId) });
  } catch (error) {
    next(error);
  }
}
// Validate and reserve an assessment attempt before calling the existing internal AI API.
export async function assessBrief(req: Request, res: Response, next: NextFunction) {
  try {
    const brief = await service.assessProjectBrief(owner(req), req.params.projectId, req.header("idempotency-key"), req.body);
    res.json({ brief });
  } catch (error) {
    next(error);
  }
}
// Persist explicit consent for the current ready brief, with no model call.
export async function confirmBrief(req: Request, res: Response, next: NextFunction) {
  try {
    emptyBody(req);
    res.json({ brief: await service.confirmProjectBrief(owner(req), req.params.projectId, req.params.briefId) });
  } catch (error) {
    next(error);
  }
}
// Make uncertain work explicitly terminal before the user chooses a new attempt/key.
export async function abandonBrief(req: Request, res: Response, next: NextFunction) {
  try {
    emptyBody(req);
    res.json({ brief: await service.abandonProjectBrief(owner(req), req.params.projectId, req.params.briefId) });
  } catch (error) {
    next(error);
  }
}
// Delegate code generation to the established idempotent publication/build workflow.
export async function generateBrief(req: Request, res: Response, next: NextFunction) {
  try {
    emptyBody(req);
    const generation = await service.generateFromBrief(
      owner(req), req.params.projectId, req.params.briefId, req.header("idempotency-key"), req.header("authorization") ?? "",
    );
    res.status(generation.status === "pending" ? 202 : 201).json({ generation });
  } catch (error) {
    next(error);
  }
}
