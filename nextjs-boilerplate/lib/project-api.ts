export type Project = {
  id: string;
  name: string;
  initialPrompt: string;
  template: "nextjs";
  status: "draft";
  createdAt: string;
};

export type GeneratedFile = {
  path: string;
  content: string;
};

export type Generation = {
  id: string;
  status: "ready";
  revisionId: string;
  revisionVersion?: number;
  provider: string;
  model: string;
  summary: string;
  files: GeneratedFile[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProject(value: unknown): value is Project {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.initialPrompt === "string" &&
    value.template === "nextjs" &&
    value.status === "draft" &&
    typeof value.createdAt === "string"
  );
}

function isGeneration(value: unknown): value is Generation {
  if (!isRecord(value) || !Array.isArray(value.files) || !isRecord(value.usage)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    value.status === "ready" &&
    typeof value.revisionId === "string" &&
    typeof value.provider === "string" &&
    typeof value.model === "string" &&
    typeof value.summary === "string" &&
    typeof value.latencyMs === "number" &&
    typeof value.usage.inputTokens === "number" &&
    typeof value.usage.outputTokens === "number" &&
    typeof value.usage.totalTokens === "number" &&
    value.files.every(
      (file) =>
        isRecord(file) &&
        typeof file.path === "string" &&
        typeof file.content === "string",
    )
  );
}

export async function createProject(prompt: string, accessToken: string): Promise<Project> {
  const response = await fetch("/api/projects", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  });

  let responseBody: unknown = null;

  try {
    responseBody = await response.json();
  } catch {
    // The status-based fallback below handles non-JSON gateway responses.
  }

  if (!response.ok) {
    const message =
      isRecord(responseBody) && typeof responseBody.message === "string"
        ? responseBody.message
        : "Could not create the project.";

    throw new Error(message);
  }

  if (!isRecord(responseBody) || !isProject(responseBody.project)) {
    throw new Error("Project Service returned an invalid response.");
  }

  return responseBody.project;
}

export async function generateProject(
  projectId: string,
  accessToken: string,
): Promise<Generation> {
  const response = await fetch(`/api/projects/${projectId}/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Idempotency-Key": crypto.randomUUID(),
    },
  });

  let responseBody: unknown = null;

  try {
    responseBody = await response.json();
  } catch {
    // The status-based fallback below handles non-JSON gateway responses.
  }

  if (!response.ok) {
    const message =
      isRecord(responseBody) && typeof responseBody.message === "string"
        ? responseBody.message
        : "Could not generate the project files.";

    throw new Error(message);
  }

  if (!isRecord(responseBody) || !isGeneration(responseBody.generation)) {
    throw new Error("Project Service returned an invalid generation response.");
  }

  return responseBody.generation;
}
