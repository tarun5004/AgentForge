import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { env } from "../config/env.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { AppError } from "../middlewares/error.middleware.js";
import { candidateHash } from "../clients/build-verification.js";
import { findOwnedGeneration } from "../repositories/generation.repository.js";
import { findOwnedProject } from "../repositories/project.repository.js";
import { assertReadResponseSize, validateObjectId, validateQueryKeys } from "../services/project-read.validation.js";

// Gate service identity before JWT/DB work, so browser credentials alone cannot read candidates.
export function createCandidateRouter() {
  const router = Router();
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const actual = req.header("x-execution-check-token");
    const expected = env.EXECUTION_CHECK_TOKEN;
    if (!expected || !actual || actual.length > 256 || Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) throw new AppError(403, "Trusted execution authentication required.");
    next();
  });
  router.get("/projects/:projectId/generations/:generationId/candidate", authenticate, async (req, res) => {
    const projectId = validateObjectId(req.params.projectId, "projectId");
    const generationId = validateObjectId(req.params.generationId, "generationId");
    validateQueryKeys(req.query, []);
    if (!req.user || !await findOwnedProject(projectId, req.user.id)) throw new AppError(404, "Candidate not found.");
    const generation = await findOwnedGeneration(projectId, req.user.id, generationId);
    if (!generation?.result || generation.buildPolicyVersion !== "next-static-build-v1" || generation.status === "failed") throw new AppError(404, "Candidate not found.");
    const response = { candidate: { projectId, generationId, snapshotHash: candidateHash(generation.result.files),
      files: generation.result.files.map(({ path, content }) => ({ path, content })) } };
    assertReadResponseSize(response);
    res.json(response);
  });
  return router;
}
