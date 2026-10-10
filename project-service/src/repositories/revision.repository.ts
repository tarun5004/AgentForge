import { Revision } from "../models/revision.model.js";
import type { GeneratedFile } from "../models/generation.model.js";
import { Types } from "mongoose";

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

export type RevisionReadRecord = RevisionSummaryRecord & { files: GeneratedFile[] };

const REVISION_SUMMARY_FIELDS = {
  _id: 1, projectId: 1, generationId: 1, version: 1, summary: 1,
  createdAt: 1, updatedAt: 1, parentRevisionId: 1, sourcePrompt: 1,
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
    .select({ ...REVISION_SUMMARY_FIELDS, files: 1 })
    .lean<RevisionReadRecord | null>();
}

type NewRevision = {
  projectId: string;
  generationId: string;
  version: number;
  summary: string;
  files: GeneratedFile[];
};

export async function insertRevision(input: NewRevision) {
  return Revision.create(input);
}
