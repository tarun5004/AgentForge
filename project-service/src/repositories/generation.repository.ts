import { mongo, type Types } from "mongoose";
import {
  Generation,
  type GenerationDocument,
  type GenerationResult,
} from "../models/generation.model.js";

export type GenerationReadRecord = GenerationDocument & { _id: Types.ObjectId };

type NewGenerationAttempt = {
  projectId: string;
  ownerId: string;
  idempotencyKey: string;
  sourcePrompt: string;
  baseRevisionId: string | null;
  requestFingerprint: string;
  expectedVersion: number;
  requestPolicyVersion: "generation-request-v1";
};

// Recognize only this unique index. Other duplicate errors must not masquerade as retries.
export function isGenerationKeyDuplicate(error: unknown): boolean {
  if (!(error instanceof mongo.MongoServerError) || error.code !== 11000) return false;
  const pattern = error.keyPattern as Record<string, unknown> | undefined;
  if (!pattern || Object.keys(pattern).length !== 2) return false;
  return pattern.projectId === 1 && pattern.idempotencyKey === 1;
}

export async function findGenerationByKey(
  projectId: string,
  ownerId: string,
  idempotencyKey: string,
) {
  // Plain data avoids exposing Mongoose internals when formatting a replay response.
  return Generation.findOne({ projectId, ownerId, idempotencyKey }).lean<GenerationReadRecord | null>();
}

// Store identity in the same insert as the pending state; a racing request cannot overwrite it.
export async function insertPendingGeneration(input: NewGenerationAttempt) {
  const generation = await Generation.create({ ...input, status: "pending" });
  return generation.toObject<GenerationReadRecord>();
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
