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

const REVISION_SUMMARY_FIELDS = {
  _id: 1, projectId: 1, generationId: 1, version: 1, summary: 1,
  createdAt: 1, updatedAt: 1, parentRevisionId: 1, sourcePrompt: 1,
} as const;

export async function findLatestRevisions(projectIds: string[]): Promise<RevisionSummaryRecord[]> {
  if (projectIds.length === 0) return [];
  // One batch for the verified project page; exclude file contents before grouping.
  return Revision.aggregate<RevisionSummaryRecord>([
    { $match: { projectId: { $in: projectIds.map((id) => new Types.ObjectId(id)) } } },
    { $sort: { projectId: 1, version: -1 } },
    { $project: REVISION_SUMMARY_FIELDS },
    { $group: { _id: "$projectId", latest: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$latest" } },
  ]);
}

export async function findLatestRevision(projectId: string) {
  return Revision.findOne({ projectId }).sort({ version: -1 })
    .select(REVISION_SUMMARY_FIELDS).lean<RevisionSummaryRecord | null>();
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
