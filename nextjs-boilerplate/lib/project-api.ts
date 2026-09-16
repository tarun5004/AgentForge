export type Project = {
  id: string;
  name: string;
  initialPrompt: string;
  template: "nextjs";
  status: "draft";
  createdAt: string;
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
