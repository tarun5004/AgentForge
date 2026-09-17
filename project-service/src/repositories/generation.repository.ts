import { Generation, type GenerationResult } from "../models/generation.model.js";

export async function findGenerationByKey(
  projectId: string,
  ownerId: string,
  idempotencyKey: string,
) {
  return Generation.findOne({ projectId, ownerId, idempotencyKey });
}

export async function insertPendingGeneration(
  projectId: string,
  ownerId: string,
  idempotencyKey: string,
) {
  return Generation.create({ projectId, ownerId, idempotencyKey, status: "pending" });
}

export async function saveGenerationResult(
  generationId: string,
  result: GenerationResult,
): Promise<void> {
  await Generation.updateOne({ _id: generationId }, { $set: { result } });
}

export async function markGenerationReady(
  generationId: string,
  revisionId: string,
): Promise<void> {
  await Generation.updateOne(
    { _id: generationId },
    { $set: { status: "ready", revisionId }, $unset: { errorCode: 1 } },
  );
}

export async function markGenerationFailed(
  generationId: string,
  errorCode: string,
): Promise<void> {
  await Generation.updateOne(
    { _id: generationId },
    { $set: { status: "failed", errorCode } },
  );
}
