import {
  Project,
  type ProjectDocument,
  type ProjectStatus,
} from "../models/project.model.js";

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
