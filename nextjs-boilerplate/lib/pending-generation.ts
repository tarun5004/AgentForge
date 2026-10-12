import type { GenerationBody } from "./project-api";

export type PendingGeneration = {
  projectId: string; key: string; body: GenerationBody; generationId?: string;
};

// The user/project-scoped key prevents a different account from restoring this intent.
function storageKey(userId: string, projectId: string): string {
  return `agentforge:pending:v1:${userId}:${projectId}`;
}

// Keep only bounded request identity, never access tokens or generated file contents.
export function savePendingGeneration(userId: string, intent: PendingGeneration): void {
  try { sessionStorage.setItem(storageKey(userId, intent.projectId), JSON.stringify(intent)); }
  catch { /* Memory still preserves retries when browser storage is disabled. */ }
}

// Storage is untrusted and can be stale; validate before offering an explicit replay.
export function readPendingGeneration(userId: string, projectId: string): PendingGeneration | null {
  try {
    const stored = sessionStorage.getItem(storageKey(userId, projectId));
    // Escaped 1,000-character prompts fit comfortably; reject oversized/stale browser data.
    if (!stored || stored.length > 10_000) return null;
    const value = JSON.parse(stored);
    if (!value || value.projectId !== projectId || typeof value.key !== "string" || !value.key.trim() || value.key.length > 100 ||
      !value.body || typeof value.body !== "object" || Array.isArray(value.body) ||
      Object.keys(value.body).some((key) => !["prompt", "baseRevisionId"].includes(key)) ||
      (value.body.prompt !== undefined && (typeof value.body.prompt !== "string" || value.body.prompt.trim().length < 10 || value.body.prompt.length > 1000)) ||
      (value.body.baseRevisionId !== undefined && (typeof value.body.baseRevisionId !== "string" || !/^[a-f\d]{24}$/i.test(value.body.baseRevisionId) || typeof value.body.prompt !== "string")) ||
      (value.generationId !== undefined && (typeof value.generationId !== "string" || !/^[a-f\d]{24}$/i.test(value.generationId)))) return null;
    // Project only expected fields so extra local-storage content cannot enter a request.
    return { projectId, key: value.key, body: { ...(value.body.prompt !== undefined ? { prompt: value.body.prompt } : {}), ...(value.body.baseRevisionId ? { baseRevisionId: value.body.baseRevisionId } : {}) }, ...(value.generationId ? { generationId: value.generationId } : {}) };
  } catch { return null; }
}

// Clear only the confirmed/explicitly abandoned attempt, not another project's pending work.
export function clearPendingGeneration(userId: string, projectId: string): void {
  try { sessionStorage.removeItem(storageKey(userId, projectId)); }
  catch { /* Disabled storage must not hide a committed server result. */ }
}
