import { AppError } from "../middlewares/error.middleware.js";
import {
  insertProject,
  findOwnedProjectForRead,
  listOwnedProjects,
  type ProjectReadRecord,
} from "../repositories/project.repository.js";
import {
  findLatestRevision,
  findLatestRevisions,
  type RevisionSummaryRecord,
} from "../repositories/revision.repository.js";
import {
  assertReadResponseSize,
  encodeProjectCursor,
  validateObjectId,
  validateProjectQuery,
  validateQueryKeys,
} from "./project-read.validation.js";

const MAX_PROMPT_LENGTH = 1000;
const MAX_NAME_LENGTH = 60;

function validatePrompt(value: unknown): string {
  if (typeof value !== "string") {
    throw new AppError(400, "prompt is required.");
  }

  const prompt = value.trim();

  if (prompt.length < 10) {
    throw new AppError(400, "prompt must be at least 10 characters long.");
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new AppError(400, `prompt must be at most ${MAX_PROMPT_LENGTH} characters long.`);
  }

  return prompt;
}

function createProjectName(prompt: string): string {
  const firstWords = prompt.split(/\s+/).slice(0, 7).join(" ");

  if (firstWords.length <= MAX_NAME_LENGTH) {
    return firstWords;
  }

  return `${firstWords.slice(0, MAX_NAME_LENGTH - 3).trim()}...`;
}

export async function createProject(ownerId: string, body: unknown) {
  if (!body || typeof body !== "object") {
    throw new AppError(400, "Request body must be a JSON object.");
  }

  const prompt = validatePrompt((body as Record<string, unknown>).prompt);
  const project = await insertProject({
    ownerId,
    name: createProjectName(prompt),
    initialPrompt: prompt,
  });

  return {
    id: project.id as string,
    name: project.name,
    initialPrompt: project.initialPrompt,
    template: project.template,
    status: project.status,
    createdAt: project.createdAt.toISOString(),
  };
}

function revisionSummary(revision: RevisionSummaryRecord) {
  return {
    id: revision._id.toString(),
    projectId: revision.projectId.toString(),
    generationId: revision.generationId.toString(),
    version: revision.version,
    summary: revision.summary,
    // Old records have no recorded lineage: null means unknown, not an inferred parent.
    parentRevisionId: revision.parentRevisionId?.toString() ?? null,
    sourcePrompt: revision.sourcePrompt ?? null,
    createdAt: revision.createdAt.toISOString(),
    updatedAt: revision.updatedAt.toISOString(),
  };
}

function projectDetails(project: ProjectReadRecord, latest: RevisionSummaryRecord | null) {
  return {
    id: project._id.toString(),
    name: project.name,
    initialPrompt: project.initialPrompt,
    template: project.template,
    status: project.status,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    latestRevision: latest ? revisionSummary(latest) : null,
  };
}

export async function listProjects(ownerId: string, query: Record<string, unknown>) {
  const { limit, cursor } = validateProjectQuery(query);
  const records = await listOwnedProjects(ownerId, limit, cursor);
  const page = records.slice(0, limit);
  const latest = await findLatestRevisions(page.map((project) => project._id.toString()));
  const latestByProject = new Map(latest.map((revision) => [revision.projectId.toString(), revision]));
  const last = page.at(-1);
  const response = {
    projects: page.map((project) => projectDetails(project, latestByProject.get(project._id.toString()) ?? null)),
    nextCursor: records.length > limit && last
      ? encodeProjectCursor({ createdAt: last.createdAt, id: last._id.toString() }) : null,
  };
  assertReadResponseSize(response);
  return response;
}

export async function getProject(ownerId: string, rawProjectId: unknown, query: Record<string, unknown>) {
  const projectId = validateObjectId(rawProjectId, "projectId");
  validateQueryKeys(query, []);
  const project = await findOwnedProjectForRead(projectId, ownerId);
  if (!project) throw new AppError(404, "Project not found.");
  const result = projectDetails(project, await findLatestRevision(projectId));
  assertReadResponseSize({ project: result });
  return result;
}
