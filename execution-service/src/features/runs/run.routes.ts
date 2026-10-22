import { Router } from "express";
import { RunError } from "./run.errors.js";
import { createRunBodySchema, runIdSchema } from "./run.schema.js";
import type { ProjectClient } from "./project.client.js";
import type { RunService } from "./run.service.js";

// Requests reference saved revisions; browsers cannot supply files, commands, images or owners.
export function createRunRouter(service: RunService, projects: ProjectClient) {
  const router = Router();
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!/^Bearer [A-Za-z0-9._~-]{1,4096}$/.test(req.headers.authorization ?? "")) {
      throw new RunError(401, "UNAUTHORIZED", "A bearer access token is required.");
    }
    next();
  });
  router.post("/", async (req, res) => {
    const input = createRunBodySchema.parse(req.body);
    const revision = await projects.loadRevision(input, req.headers.authorization!);
    const run = service.start(revision);
    res.status(run.state === "ready" ? 200 : 202).json({ run });
  });
  router.get("/:runId", async (req, res) => {
    const run = service.find(runIdSchema.parse(req.params.runId));
    await projects.authorize(run.projectId, req.headers.authorization!);
    res.json({ run: service.describe(run) });
  });
  router.post("/:runId/activity", async (req, res) => {
    const run = service.find(runIdSchema.parse(req.params.runId));
    await projects.authorize(run.projectId, req.headers.authorization!);
    res.json({ run: service.touch(run) });
  });
  router.delete("/:runId", async (req, res) => {
    const run = service.find(runIdSchema.parse(req.params.runId));
    await projects.authorize(run.projectId, req.headers.authorization!);
    res.json({ run: service.cancel(run) });
  });
  return router;
}
