import { Router } from "express";

import {
  createGenerationController,
  createProjectController,
} from "../controllers/project.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const projectRouter = Router();

projectRouter.post("/", authenticate, createProjectController);
projectRouter.post(
  "/:projectId/generations",
  authenticate,
  createGenerationController,
);

export default projectRouter;
