import { Project, type ProjectDocument } from "../models/project.model.js";

type NewProject = Pick<ProjectDocument, "ownerId" | "name" | "initialPrompt">;

export async function insertProject(input: NewProject) {
  return Project.create({
    ...input,
    template: "nextjs",
    status: "draft",
  });
}
