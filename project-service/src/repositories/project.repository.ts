import {
  Project,
  type ProjectDocument,
  type ProjectStatus,
} from "../models/project.model.js";
import type { Types } from "mongoose";
import type { ProjectCursor } from "../services/project-read.validation.js";

export type ProjectReadRecord = Omit<ProjectDocument, "ownerId" | "currentRevisionNumber"> & { _id: Types.ObjectId };
const PROJECT_READ_FIELDS = "_id name initialPrompt template status createdAt updatedAt";

export async function listOwnedProjects(ownerId: string, limit: number, cursor: ProjectCursor | null) {
  const position = cursor ? {
    $or: [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
    ],
  } : {};
  return Project.find({ ownerId, ...position })
    .select(PROJECT_READ_FIELDS)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<ProjectReadRecord[]>();
}

export async function findOwnedProjectForRead(projectId: string, ownerId: string) {
  return Project.findOne({ _id: projectId, ownerId })
    .select(PROJECT_READ_FIELDS)
    .lean<ProjectReadRecord | null>();
}

type NewProject = Pick<ProjectDocument, "ownerId" | "name" | "initialPrompt">;

export async function insertProject(input: NewProject) {
  return Project.create({
    ...input,
    template: "nextjs",
    status: "draft",
  });
}

export async function findOwnedProject(projectId: string, ownerId: string) {
  return Project.findOne({ _id: projectId, ownerId });
}

export async function setProjectStatus(
  projectId: string,
  status: ProjectStatus,
): Promise<void> {
  await Project.updateOne({ _id: projectId }, { $set: { status } });
}

export async function reserveNextRevisionNumber(projectId: string): Promise<number> {
  const project = await Project.findByIdAndUpdate(
    projectId,
    { $inc: { currentRevisionNumber: 1 } },
    { new: true },
  );

  if (!project) {
    throw new Error("Project disappeared while creating a revision.");
  }

  return project.currentRevisionNumber;
}
