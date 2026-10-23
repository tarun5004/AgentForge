import { Revision } from "../models/revision.model.js";
import type { GeneratedFile, GenerationResult } from "../models/generation.model.js";
import { mongo, Types } from "mongoose";
import type { BuildVerification } from "../clients/build-verification.js";

export type RevisionSummaryRecord = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  generationId: Types.ObjectId;
  version: number;
  summary: string;
  createdAt: Date;
  updatedAt: Date;
  parentRevisionId?: Types.ObjectId | null;
  sourcePrompt?: string | null;
};

export type RevisionReadRecord = RevisionSummaryRecord & { files: GeneratedFile[]; schemaVersion?: number; buildVerification?: BuildVerification } &
  Partial<Pick<GenerationResult, "provider" | "model" | "usage" | "latencyMs" | "fileChanges" | "validation">>;

const REVISION_SUMMARY_FIELDS = {
  _id: 1, projectId: 1, generationId: 1, version: 1, summary: 1,
  createdAt: 1, updatedAt: 1, parentRevisionId: 1, sourcePrompt: 1,
} as const;
const REVISION_DETAIL_FIELDS = {
  ...REVISION_SUMMARY_FIELDS, files: 1, fileChanges: 1, provider: 1, model: 1,
  usage: 1, latencyMs: 1, validation: 1, schemaVersion: 1, buildVerification: 1,
} as const;

export async function findLatestRevisions(projectIds: string[]): Promise<RevisionSummaryRecord[]> {
  if (projectIds.length === 0) return [];
  // One batch for the verified project page; exclude file contents before grouping.
  return Revision.aggregate<RevisionSummaryRecord>([
    { $match: { projectId: { $in: projectIds.map((id) => new Types.ObjectId(id)) } } },
    // Reverse the existing (projectId, version) index; group order is not public order.
    { $sort: { projectId: -1, version: -1 } },
    { $project: REVISION_SUMMARY_FIELDS },
    { $group: { _id: "$projectId", latest: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$latest" } },
  ]);
}

export async function findLatestRevision(projectId: string) {
  return Revision.findOne({ projectId }).sort({ version: -1 })
    .select(REVISION_SUMMARY_FIELDS).lean<RevisionSummaryRecord | null>();
}

export async function listProjectRevisions(projectId: string, limit: number, beforeVersion: number | null) {
  const versionFilter = beforeVersion === null ? {} : { version: { $lt: beforeVersion } };
  return Revision.find({ projectId, ...versionFilter })
    .select(REVISION_SUMMARY_FIELDS)
    .sort({ version: -1 })
    .limit(limit + 1)
    .lean<RevisionSummaryRecord[]>();
}

export async function findProjectRevision(projectId: string, revisionId: string) {
  return Revision.findOne({ projectId, _id: revisionId })
    .select(REVISION_DETAIL_FIELDS)
    .lean<RevisionReadRecord | null>();
}

// A saved revision is stronger evidence than mutable Generation status after a partial failure.
// Callers must prove project ownership first; both IDs keep the lookup project-scoped.
export async function findRevisionForGeneration(projectId: string, generationId: string) {
  return Revision.findOne({ projectId, generationId })
    .select(REVISION_DETAIL_FIELDS)
    .lean<RevisionReadRecord | null>();
}

export type NewRevision = {
  projectId: string;
  generationId: string;
  version: number;
  summary: string;
  files: GeneratedFile[];
  parentRevisionId: string | null;
  sourcePrompt: string;
  provider: string;
  model: string;
  usage: GenerationResult["usage"];
  latencyMs: number;
  fileChanges: NonNullable<GenerationResult["fileChanges"]>;
  validation: NonNullable<GenerationResult["validation"]>;
  schemaVersion: 2;
  buildVerification?: BuildVerification;
};

// Classify only the version uniqueness constraint; do not disguise other DB errors as conflicts.
export function isRevisionVersionDuplicate(error: unknown): boolean {
  if (!(error instanceof mongo.MongoServerError) || error.code !== 11000) return false;
  const pattern = error.keyPattern as Record<string, unknown> | undefined;
  return !!pattern && Object.keys(pattern).length === 2 && pattern.projectId === 1 && pattern.version === 1;
}

// One insert is the commit point. No subsequent bookkeeping update can unpublish this snapshot.
export async function insertRevision(input: NewRevision) {
  const revision = await Revision.create(input);
  return revision.toObject<RevisionReadRecord>();
}
