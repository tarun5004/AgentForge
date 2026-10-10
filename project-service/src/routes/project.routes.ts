import { Router } from "express";

import {
  createGenerationController,
  createProjectController,
  getProjectController,
  listProjectsController,
} from "../controllers/project.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const projectRouter = Router();

projectRouter.get("/", authenticate, listProjectsController);
projectRouter.get("/:projectId", authenticate, getProjectController);

projectRouter.post("/", authenticate, createProjectController);
projectRouter.post(
  "/:projectId/generations",
  authenticate,
  createGenerationController,
);

export default projectRouter;
