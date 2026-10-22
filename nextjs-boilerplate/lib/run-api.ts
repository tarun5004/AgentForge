import { requestWithSession, type ProjectAccess } from "./session-request.ts";

export type PreviewRun = {
  id: string; projectId: string; revisionId: string;
  state: "building" | "cancelling" | "ready" | "failed" | "cancelled" | "expired";
  message: string; errorCode: "BUILD_FAILED" | "CLEANUP_UNCONFIRMED" | null;
  createdAt: string; previewUrl: string | null;
};

// Preserve a definite 401 so the existing session layer, not an upstream build error, controls login.
export class RunApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

// Never turn an API-provided URL into arbitrary browser navigation or same-origin executable HTML.
export function isPreviewUrl(value: unknown, runId: string): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && Boolean(url.port) &&
      !url.username && !url.password && !url.search && !url.hash &&
      new RegExp(`^/preview/${runId}/[a-f0-9]{48}/$`).test(url.pathname);
  } catch { return false; }
}

// Check response identity and capability shape before displaying a saved revision's preview.
function parseRun(value: unknown): PreviewRun {
  if (!value || typeof value !== "object") throw new RunApiError("Invalid Execution Service response.", 502);
  const run = value as Record<string, unknown>;
  const valid = typeof run.id === "string" && /^[a-f0-9-]{36}$/.test(run.id) &&
    typeof run.projectId === "string" && /^[a-f0-9]{24}$/.test(run.projectId) &&
    typeof run.revisionId === "string" && /^[a-f0-9]{24}$/.test(run.revisionId) &&
    typeof run.state === "string" && ["building", "cancelling", "ready", "failed", "cancelled", "expired"].includes(run.state) &&
    typeof run.message === "string" && run.message.length <= 300 &&
    (run.errorCode === null || run.errorCode === "BUILD_FAILED" || run.errorCode === "CLEANUP_UNCONFIRMED") &&
    typeof run.createdAt === "string" && Number.isFinite(Date.parse(run.createdAt)) &&
    (run.state === "ready" ? isPreviewUrl(run.previewUrl, run.id) : run.previewUrl === null);
  if (!valid) throw new RunApiError("Invalid Execution Service response.", 502);
  return run as PreviewRun;
}

// Reuse the proven single-refresh request path; build failures must never log the user out.
async function request(path: string, access: ProjectAccess, method: string, signal: AbortSignal, body?: string) {
  const response = await requestWithSession(`/api/runs${path}`, access, {
    method, signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), cache: "no-store",
    headers: { "Content-Type": "application/json" }, ...(body ? { body } : {}),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
      ? payload.message.slice(0, 300) : "Preview request failed. Check the local Execution Service.";
    throw new RunApiError(message, response.status);
  }
  return parseRun(payload && typeof payload === "object" && "run" in payload ? payload.run : null);
}

// The browser references immutable saved files; it cannot choose commands or submit source.
export async function startRun(projectId: string, revisionId: string, access: ProjectAccess, signal: AbortSignal) {
  if (!/^[a-f0-9]{24}$/.test(projectId) || !/^[a-f0-9]{24}$/.test(revisionId)) throw new RunApiError("Invalid saved revision.", 400);
  const run = await request("", access, "POST", signal, JSON.stringify({ projectId, revisionId }));
  if (run.projectId !== projectId || run.revisionId !== revisionId) throw new RunApiError("Preview revision mismatch.", 502);
  return run;
}

// Every later operation is bound to the original run ID, not a changing editor selection.
export async function updateRun(id: string, action: "read" | "stop" | "activity", access: ProjectAccess, signal: AbortSignal) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new RunApiError("Invalid preview ID.", 400);
  const run = await request(`/${id}${action === "activity" ? "/activity" : ""}`, access,
    action === "stop" ? "DELETE" : action === "activity" ? "POST" : "GET", signal);
  if (run.id !== id) throw new RunApiError("Preview run mismatch.", 502);
  return run;
}
