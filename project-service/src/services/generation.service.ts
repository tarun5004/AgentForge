import { isValidObjectId } from "mongoose";

import { requestProjectGeneration } from "../clients/ai-orchestrator.client.js";
import { AppError } from "../middlewares/error.middleware.js";
import type { GenerationResult } from "../models/generation.model.js";
import {
  findGenerationByKey,
  insertPendingGeneration,
  markGenerationFailed,
  markGenerationReady,
  saveGenerationResult,
} from "../repositories/generation.repository.js";
import {
  findOwnedProject,
  reserveNextRevisionNumber,
  setProjectStatus,
} from "../repositories/project.repository.js";
import { insertRevision } from "../repositories/revision.repository.js";

function validateIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(400, "Idempotency-Key header is required.");
  }

  const key = value.trim();

  if (key.length > 100) {
    throw new AppError(400, "Idempotency-Key must be at most 100 characters.");
  }

  return key;
}

function formatCompletedGeneration(generation: {
  _id: unknown;
  revisionId?: unknown;
  result?: GenerationResult;
}) {
  if (!generation.result || !generation.revisionId) {
    throw new Error("Completed generation is missing its saved result.");
  }

  return {
    id: String(generation._id),
    status: "ready" as const,
    revisionId: String(generation.revisionId),
    ...generation.result,
  };
}

export async function createGeneration(
  ownerId: string,
  projectId: string,
  idempotencyHeader: unknown,
) {
  if (!isValidObjectId(projectId)) {
    throw new AppError(400, "projectId is invalid.");
  }

  const idempotencyKey = validateIdempotencyKey(idempotencyHeader);
  const project = await findOwnedProject(projectId, ownerId);

  if (!project) {
    throw new AppError(404, "Project not found.");
  }

  const existingGeneration = await findGenerationByKey(
    projectId,
    ownerId,
    idempotencyKey,
  );

  if (existingGeneration?.status === "ready") {
    return formatCompletedGeneration(existingGeneration);
  }

  if (existingGeneration) {
    throw new AppError(
      409,
      existingGeneration.status === "pending"
        ? "This generation is already running."
        : "This generation failed. Send a new Idempotency-Key to retry.",
    );
  }

  const generation = await insertPendingGeneration(projectId, ownerId, idempotencyKey);
  const generationId = generation._id.toString();
  await setProjectStatus(projectId, "generating");

  try {
    const aiResult = await requestProjectGeneration({
      requestId: generationId,
      projectId,
      prompt: project.initialPrompt,
    });
    const savedResult: GenerationResult = {
      provider: aiResult.provider,
      model: aiResult.model,
      summary: aiResult.summary,
      files: aiResult.files,
      usage: aiResult.usage,
      latencyMs: aiResult.latencyMs,
    };

    // Save the model result before publishing a revision so paid output is never lost.
    await saveGenerationResult(generationId, savedResult);

    const version = await reserveNextRevisionNumber(projectId);
    const revision = await insertRevision({
      projectId,
      generationId,
      version,
      summary: savedResult.summary,
      files: savedResult.files,
    });

    await markGenerationReady(generationId, revision._id.toString());
    await setProjectStatus(projectId, "ready");

    return {
      id: generationId,
      status: "ready" as const,
      revisionId: revision._id.toString(),
      revisionVersion: version,
      ...savedResult,
    };
  } catch (error) {
    await markGenerationFailed(generationId, "AI_GENERATION_FAILED");
    await setProjectStatus(projectId, "failed");
    throw new AppError(502, "Code generation failed. Please try again.");
  }
}
