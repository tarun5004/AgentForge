import { Router } from "express";

import {
  createGenerationController,
  createProjectController,
  getProjectController,
  listProjectsController,
  getRevisionController,
  listRevisionsController,
  getGenerationController,
  createRepairController,
} from "../controllers/project.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import * as brief from "../controllers/brief.controller.js";

const projectRouter = Router();

projectRouter.get("/:projectId/brief", authenticate, brief.getBrief);
projectRouter.post("/:projectId/brief", authenticate, brief.assessBrief);
projectRouter.post("/:projectId/brief/:briefId/confirm", authenticate, brief.confirmBrief);
projectRouter.post("/:projectId/brief/:briefId/abandon", authenticate, brief.abandonBrief);
projectRouter.post("/:projectId/brief/:briefId/generations", authenticate, brief.generateBrief);

projectRouter.get("/", authenticate, listProjectsController);
projectRouter.get("/:projectId", authenticate, getProjectController);
projectRouter.get("/:projectId/revisions", authenticate, listRevisionsController);
projectRouter.get("/:projectId/revisions/:revisionId", authenticate, getRevisionController);
projectRouter.get("/:projectId/generations/:generationId", authenticate, getGenerationController);
projectRouter.post("/:projectId/generations/:generationId/repair", authenticate, createRepairController);

projectRouter.post("/", authenticate, createProjectController);
projectRouter.post(
  "/:projectId/generations",
  authenticate,
  createGenerationController,
);

export default projectRouter;
