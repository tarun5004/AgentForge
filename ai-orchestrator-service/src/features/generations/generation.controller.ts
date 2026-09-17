import type { NextFunction, Request, Response } from "express";

import { generationRequestSchema } from "./generation.schema.js";
import { generateProject } from "./generation.service.js";

export async function createGenerationController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const request = generationRequestSchema.parse(req.body);
    const generation = await generateProject(request);
    res.status(200).json({ generation });
  } catch (error) {
    next(error);
  }
}
