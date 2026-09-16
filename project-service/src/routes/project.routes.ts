import { Router } from "express";

import { createProjectController } from "../controllers/project.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const projectRouter = Router();

projectRouter.post("/", authenticate, createProjectController);

export default projectRouter;
