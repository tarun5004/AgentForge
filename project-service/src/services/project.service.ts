import { AppError } from "../middlewares/error.middleware.js";
import { insertProject } from "../repositories/project.repository.js";

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
