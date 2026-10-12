export type GeneratedFile = { path: string; content: string };
export type FileChange = { path: string; status: "A" | "M" | "D" };
export type Usage = { inputTokens: number; outputTokens: number; totalTokens: number };
export type Validation = { policyVersion: "frontend-manifest-v1"; status: "manifest_validated" };
export type Project = {
  id: string; name: string; initialPrompt: string; template: "nextjs";
  status: "draft" | "generating" | "ready" | "failed";
  createdAt: string; updatedAt?: string;
  latestRevision?: { id: string; version: number } | null;
};
export type RevisionSummary = {
  id: string; projectId: string; generationId: string; version: number;
  summary: string; parentRevisionId: string | null; sourcePrompt: string | null;
  createdAt: string; updatedAt: string;
};
export type Revision = RevisionSummary & {
  files: GeneratedFile[]; fileChanges: FileChange[] | null;
  provider: string | null; model: string | null; usage: Usage | null;
  latencyMs: number | null; validation: Validation | null; schemaVersion: number | null;
};
export type Generation = {
  id: string; status: "ready"; revisionId: string; revisionVersion: number;
  parentRevisionId: string | null; sourcePrompt: string | null;
  provider: string; model: string; summary: string; files: GeneratedFile[];
  fileChanges: FileChange[] | null; validation: Validation | null;
  usage: Usage; latencyMs: number;
};
export type GenerationStatus = Generation | {
  id: string; status: "pending" | "failed"; hasSavedResult: boolean; errorCode: string | null;
};
export type GenerationBody = { prompt?: string; baseRevisionId?: string };

// Preserve status/codes so the UI distinguishes retryable uncertainty from terminal failure.
export class ProjectApiError extends Error {
  status: number;
  code?: string;
  generationId?: string;
  latestRevisionId?: string;
  constructor(message: string, status: number, code?: string, generationId?: string, latestRevisionId?: string) {
    super(message);
    this.name = "ProjectApiError";
    this.status = status;
    this.code = code;
    this.generationId = generationId;
    this.latestRevisionId = latestRevisionId;
  }
}

// JSON from another service needs runtime checks; TypeScript types alone cannot validate it.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// IDs go into URL paths; reject unexpected text before constructing a request.
export function isProjectId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
}

// Version and usage counters must not be negative, fractional or infinite.
function isCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// Backend dates are serialized timestamps, not model-generated labels.
function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

// Both draft creation and saved ready/failed projects share public identity fields.
function isProject(value: unknown): value is Project {
  return isRecord(value) && isProjectId(value.id) && typeof value.name === "string" &&
    typeof value.initialPrompt === "string" && value.template === "nextjs" &&
    typeof value.status === "string" && ["draft", "generating", "ready", "failed"].includes(value.status) && isDate(value.createdAt) &&
    (value.updatedAt === undefined || isDate(value.updatedAt)) &&
    (value.latestRevision === undefined || value.latestRevision === null ||
      (isRecord(value.latestRevision) && isProjectId(value.latestRevision.id) && isCounter(value.latestRevision.version) && value.latestRevision.version > 0));
}

// Unknown legacy lineage stays null; never invent a parent or producing prompt.
function isRevisionSummary(value: unknown): value is RevisionSummary {
  return isRecord(value) && isProjectId(value.id) && isProjectId(value.projectId) &&
    isProjectId(value.generationId) && isCounter(value.version) && value.version > 0 &&
    typeof value.summary === "string" && (value.parentRevisionId === null || isProjectId(value.parentRevisionId)) &&
    (value.sourcePrompt === null || typeof value.sourcePrompt === "string") && isDate(value.createdAt) && isDate(value.updatedAt);
}

// File contents remain plain text in the viewer, never executable HTML.
function isFiles(value: unknown): value is GeneratedFile[] {
  return Array.isArray(value) && value.every((file) => isRecord(file) && typeof file.path === "string" && typeof file.content === "string");
}

// Null means missing historical metadata, not "every file was added".
function isChanges(value: unknown): value is FileChange[] | null {
  return value === null || (Array.isArray(value) && value.every((change) => isRecord(change) && typeof change.path === "string" && typeof change.status === "string" && ["A", "M", "D"].includes(change.status)));
}

// Display usage only when all measured counters exist.
function isUsage(value: unknown): value is Usage {
  return isRecord(value) && isCounter(value.inputTokens) && isCounter(value.outputTokens) && isCounter(value.totalTokens);
}

// Manifest checks must not be mistaken for successful builds or execution.
function isValidation(value: unknown): value is Validation | null {
  return value === null || (isRecord(value) && value.policyVersion === "frontend-manifest-v1" && value.status === "manifest_validated");
}

// Complete snapshots carry nullable provenance for older records.
function isRevision(value: unknown): value is Revision {
  return isRecord(value) && isFiles(value.files) && isChanges(value.fileChanges) &&
    (value.provider === null || typeof value.provider === "string") && (value.model === null || typeof value.model === "string") &&
    (value.usage === null || isUsage(value.usage)) && (value.latencyMs === null || isCounter(value.latencyMs)) &&
    isValidation(value.validation) && (value.schemaVersion === null || value.schemaVersion === 2) && isRevisionSummary(value);
}

// Ready output always identifies the committed revision and its actual version.
function isGeneration(value: unknown): value is Generation {
  return isRecord(value) && isProjectId(value.id) && value.status === "ready" && isProjectId(value.revisionId) &&
    isCounter(value.revisionVersion) && value.revisionVersion > 0 &&
    (value.parentRevisionId === null || isProjectId(value.parentRevisionId)) &&
    (value.sourcePrompt === null || typeof value.sourcePrompt === "string") &&
    typeof value.provider === "string" && typeof value.model === "string" && typeof value.summary === "string" &&
    isFiles(value.files) && isChanges(value.fileChanges) && isValidation(value.validation) && isUsage(value.usage) && isCounter(value.latencyMs);
}

// One error/JSON boundary handles all endpoints, including non-JSON proxy failures.
async function request(path: string, token: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/projects${path}`, {
    ...init, cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* Status-based fallback handles proxy HTML. */ }
  if (!response.ok) {
    const error = isRecord(body) ? body : {};
    throw new ProjectApiError(
      typeof error.message === "string" ? error.message : "Project request failed. Please try again.", response.status,
      typeof error.code === "string" ? error.code : undefined,
      isProjectId(error.generationId) ? error.generationId : undefined,
      isProjectId(error.latestRevisionId) ? error.latestRevisionId : undefined,
    );
  }
  if (!isRecord(body)) throw new Error("Project Service returned an invalid response.");
  return body;
}

// Reject malformed path IDs before sending a request.
function projectPath(id: string): string {
  if (!isProjectId(id)) throw new Error("Invalid project or revision ID.");
  return `/${id.toLowerCase()}`;
}

// Save a draft once; generation retries reuse its returned ID.
export async function createProject(prompt: string, token: string): Promise<Project> {
  const body = await request("", token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
  if (!isProject(body.project)) throw new Error("Project Service returned an invalid project response.");
  return body.project;
}

// Bounded project pages prevent loading the entire database into the sidebar.
export async function listProjects(token: string, cursor: string | null = null, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  const body = await request(`?${query}`, token, { signal });
  if (!Array.isArray(body.projects) || !body.projects.every(isProject) || !(body.nextCursor === null || typeof body.nextCursor === "string")) throw new Error("Invalid project list response.");
  return { projects: body.projects as Project[], nextCursor: body.nextCursor as string | null };
}

// Detail identifies the actual latest revision, independent of advisory status.
export async function getProject(id: string, token: string, signal?: AbortSignal): Promise<Project> {
  const body = await request(projectPath(id), token, { signal });
  if (!isProject(body.project) || body.project.id !== id.toLowerCase()) throw new Error("Invalid project detail response.");
  return body.project;
}

// Revision pagination uses an exclusive version cursor, not the opaque project cursor.
export async function listRevisions(id: string, token: string, cursor: string | null = null, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("beforeVersion", cursor);
  const body = await request(`${projectPath(id)}/revisions?${query}`, token, { signal });
  if (!Array.isArray(body.revisions) || !body.revisions.every((revision) => isRevisionSummary(revision) && revision.projectId === id.toLowerCase()) || !(body.nextCursor === null || typeof body.nextCursor === "string")) throw new Error("Invalid revision history response.");
  return { revisions: body.revisions as RevisionSummary[], nextCursor: body.nextCursor as string | null };
}

// Restore files from an owned persisted snapshot, not local/demo data.
export async function getRevision(projectId: string, revisionId: string, token: string, signal?: AbortSignal): Promise<Revision> {
  const body = await request(`${projectPath(projectId)}/revisions${projectPath(revisionId)}`, token, { signal });
  if (!isRevision(body.revision) || body.revision.projectId !== projectId.toLowerCase() || body.revision.id !== revisionId.toLowerCase()) throw new Error("Invalid revision detail response.");
  return body.revision;
}

// One caller-owned key identifies one attempt and must survive transport retries.
export async function generateProject(projectId: string, token: string, key: string, input: GenerationBody): Promise<Generation> {
  const body = await request(`${projectPath(projectId)}/generations`, token, {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(input),
    signal: AbortSignal.timeout(100_000),
  });
  if (!isGeneration(body.generation)) throw new Error("Invalid generation response. Keep the request key and check again.");
  return body.generation;
}

// Read uncertainty without starting AI or publishing saved output.
export async function getGeneration(projectId: string, generationId: string, token: string): Promise<GenerationStatus> {
  const body = await request(`${projectPath(projectId)}/generations${projectPath(generationId)}`, token);
  if (isGeneration(body.generation) && body.generation.id === generationId) return body.generation;
  const value = body.generation;
  if (!isRecord(value) || value.id !== generationId || typeof value.status !== "string" || !["pending", "failed"].includes(value.status) || typeof value.hasSavedResult !== "boolean" || !(value.errorCode === null || typeof value.errorCode === "string")) throw new Error("Invalid generation status response.");
  return value as GenerationStatus;
}
