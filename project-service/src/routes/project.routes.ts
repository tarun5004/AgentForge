import { Router } from "express";

import {
  createGenerationController,
  createProjectController,
  getProjectController,
  listProjectsController,
  getRevisionController,
  listRevisionsController,
  getGenerationController,
} from "../controllers/project.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const projectRouter = Router();

projectRouter.get("/", authenticate, listProjectsController);
projectRouter.get("/:projectId", authenticate, getProjectController);
projectRouter.get("/:projectId/revisions", authenticate, listRevisionsController);
projectRouter.get("/:projectId/revisions/:revisionId", authenticate, getRevisionController);
projectRouter.get("/:projectId/generations/:generationId", authenticate, getGenerationController);

projectRouter.post("/", authenticate, createProjectController);
projectRouter.post(
  "/:projectId/generations",
  authenticate,
  createGenerationController,
);

export default projectRouter;
