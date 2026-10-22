import { RunError } from "./run.errors.js";
import { validateRevision, type CreateRunBody } from "./run.schema.js";

// Bound upstream bodies before parsing so a bad internal response cannot exhaust memory.
async function readJson(response: Response): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (!response.body) throw new Error("Missing response.");
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 1_000_000) throw new Error("Oversized response.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// Project Service remains the ownership authority; never decode an unverified JWT here.
export function createProjectClient(baseUrl: string) {
  // A transport failure is retryable; it is never treated as proof of ownership.
  async function request(path: string, authorization: string): Promise<unknown> {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { authorization }, redirect: "error", signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) await response.body?.cancel();
      if (response.status === 401) throw new RunError(401, "UNAUTHORIZED", "Please sign in again.");
      if (response.status === 404 || response.status === 403) {
        throw new RunError(404, "NOT_FOUND", "Project or revision not found.");
      }
      if (!response.ok) throw new Error("Upstream failed.");
      return await readJson(response);
    } catch (error) {
      if (error instanceof RunError) throw error;
      throw new RunError(503, "PROJECT_UNAVAILABLE", "Project Service is unavailable.");
    }
  }

  return {
    // Load source only through the existing owner-scoped revision endpoint.
    async loadRevision(input: CreateRunBody, authorization: string) {
      const body = await request(`/api/projects/${input.projectId}/revisions/${input.revisionId}`, authorization);
      try {
        const revision = validateRevision((body as { revision?: unknown }).revision);
        if (revision.id !== input.revisionId || revision.projectId !== input.projectId) throw new Error();
        return revision;
      } catch {
        throw new RunError(422, "UNSUPPORTED_REVISION", "Revision is not supported by the frontend preview template.");
      }
    },
    // Recheck access on every status/cancel request, including after a token expires.
    async authorize(projectId: string, authorization: string) {
      const body = await request(`/api/projects/${projectId}`, authorization);
      if (!body || typeof body !== "object" || (body as { project?: { id?: string } }).project?.id !== projectId) {
        throw new RunError(503, "PROJECT_UNAVAILABLE", "Invalid Project Service response.");
      }
    },
  };
}

export type ProjectClient = ReturnType<typeof createProjectClient>;
