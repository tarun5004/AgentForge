import { mongo, type Types } from "mongoose";
import {
  Generation,
  type GenerationDocument,
  type GenerationResult,
} from "../models/generation.model.js";
import type { BuildVerification } from "../clients/build-verification.js";

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
  buildPolicyVersion?: "next-static-build-v1";
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

// The controller's caller already proved project ownership; never fetch an attempt by ID alone.
export async function findOwnedGeneration(projectId: string, ownerId: string, generationId: string) {
  return Generation.findOne({ _id: generationId, projectId, ownerId }).lean<GenerationReadRecord | null>();
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
  const saved = await Generation.updateOne(
    { _id: generationId, status: "pending", result: { $exists: false } },
    { $set: { result } }, { runValidators: true },
  );
  if (saved.matchedCount !== 1) throw new Error("The pending generation result could not be stored.");
}

export async function markGenerationReady(
  generationId: string,
  revisionId: string,
): Promise<void> {
  await Generation.updateOne(
    // Normal replay leaves completedAt stable; a stale pointer still needs repair.
    { _id: generationId, $or: [{ status: { $ne: "ready" } }, { revisionId: { $ne: revisionId } }] },
    { $set: { status: "ready", revisionId, completedAt: new Date() }, $unset: { errorCode: 1, failedAt: 1 } },
  );
}

export async function markGenerationFailed(
  generationId: string,
  errorCode: string,
): Promise<void> {
  await Generation.updateOne(
    { _id: generationId, status: "pending" },
    { $set: { status: "failed", errorCode, failedAt: new Date() } },
  );
}

// Save only the first proof on a still-pending gated attempt; reread after a racing acknowledgement.
export async function saveBuildVerification(generationId: string, proof: BuildVerification): Promise<void> {
  await Generation.updateOne(
    { _id: generationId, status: "pending", buildPolicyVersion: "next-static-build-v1", buildVerification: { $exists: false } },
    { $set: { buildVerification: proof } }, { runValidators: true },
  );
}
