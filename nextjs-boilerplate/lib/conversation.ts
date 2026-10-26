import type { Project, RevisionSummary, GenerationStatus } from "./project-api.ts";

export type ChatEntry = {
  id: string;
  role: "user" | "assistant";
  kind: "message" | "activity" | "result" | "requirements";
  text: string;
  createdAt: string;
  state?: "working" | "done" | "error" | "unknown";
  details?: string[];
  revisionId?: string;
};
export type Conversation = { entries: ChatEntry[]; trimmed: boolean; warning: string };
const MAX_ENTRIES = 120;
const MAX_BYTES = 400_000;

// Local history is a convenience cache, scoped to the signed-in account and owned project.
function storageKey(userId: string, projectId: string): string {
  return `agentforge:conversation:v1:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`;
}

// Browser storage can be edited; accept only small display records, never executable content.
export function isChatEntry(value: unknown): value is ChatEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string" && entry.id.length > 0 && entry.id.length <= 200 &&
    typeof entry.role === "string" && ["user", "assistant"].includes(entry.role) &&
    typeof entry.kind === "string" && ["message", "activity", "result", "requirements"].includes(entry.kind) &&
    typeof entry.text === "string" && entry.text.length <= 2000 &&
    typeof entry.createdAt === "string" && Number.isFinite(Date.parse(entry.createdAt)) &&
    (entry.state === undefined || (typeof entry.state === "string" && ["working", "done", "error", "unknown"].includes(entry.state))) &&
    (entry.revisionId === undefined || (typeof entry.revisionId === "string" && /^[a-f0-9]{24}$/i.test(entry.revisionId))) &&
    (entry.details === undefined || (Array.isArray(entry.details) && entry.details.length <= 40 &&
      entry.details.every((line) => typeof line === "string" && line.length <= 1000))) &&
    Object.keys(entry).every((key) => ["id", "role", "kind", "text", "createdAt", "state", "details", "revisionId"].includes(key));
}

// Updating one attempt in place prevents polling and same-key replay from duplicating messages.
export function upsertChatEntry(conversation: Conversation, entry: ChatEntry): Conversation {
  if (!isChatEntry(entry)) return conversation;
  const previous = conversation.entries.find((item) => item.id === entry.id);
  const entries = previous
    ? conversation.entries.map((item) => item.id === entry.id ? { ...entry, createdAt: item.createdAt } : item)
    : [...conversation.entries, entry];
  // A reconstructed server brief may be older than cached UI events; keep actual timestamps in order.
  entries.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  let trimmed = conversation.trimmed;
  while (entries.length > MAX_ENTRIES || new TextEncoder().encode(JSON.stringify(entries)).length > MAX_BYTES) {
    entries.shift(); trimmed = true;
  }
  return { entries, trimmed, warning: conversation.warning };
}

// Refresh never resumes a model call: interrupted activity becomes explicitly unconfirmed.
export function readConversation(userId: string, projectId: string): Conversation {
  const empty: Conversation = { entries: [], trimmed: false, warning: "" };
  try {
    const raw = localStorage.getItem(storageKey(userId, projectId));
    if (!raw) return empty;
    if (raw.length > MAX_BYTES * 2) throw new Error("Oversized history");
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !Array.isArray(saved.entries) || saved.entries.length > MAX_ENTRIES ||
      !saved.entries.every(isChatEntry) || new Set(saved.entries.map((entry: ChatEntry) => entry.id)).size !== saved.entries.length ||
      typeof saved.trimmed !== "boolean") throw new Error("Invalid history");
    return { entries: saved.entries.map((entry: ChatEntry) => entry.state === "working"
      ? { ...entry, state: "unknown", text: "Interrupted or refreshed. Check the saved attempt; completion is not confirmed." } : entry),
    trimmed: saved.trimmed, warning: "" };
  } catch {
    return { ...empty, warning: "Local chat history is unavailable. Saved backend revisions are still available." };
  }
}

// Store summaries only: no access tokens, provider keys, generated source files or hidden reasoning.
export function saveConversation(userId: string, projectId: string, conversation: Conversation): boolean {
  try {
    localStorage.setItem(storageKey(userId, projectId), JSON.stringify({ version: 1, entries: conversation.entries, trimmed: conversation.trimmed }));
    return true;
  } catch { return false; }
}

// Delete only this account/project's display cache, never saved files or pending request identity.
export function clearConversation(userId: string, projectId: string): void {
  try { localStorage.removeItem(storageKey(userId, projectId)); }
  catch { /* The hook still clears its in-memory display; the warning remains visible. */ }
}

// Rebuild missing prompts/results from canonical revision metadata without fabricating tool history.
export function restoreRevisionMessages(project: Project, revisions: RevisionSummary[], conversation: Conversation): Conversation {
  let result = conversation;
  if (!result.entries.some((entry) => entry.id === "initial-request")) {
    result = upsertChatEntry(result, { id: "initial-request", role: "user", kind: "message",
      text: project.initialPrompt, createdAt: project.createdAt });
  }
  for (const revision of [...revisions].reverse()) {
    if (result.entries.some((entry) => entry.revisionId === revision.id && entry.kind === "result")) continue;
    if (revision.version > 1 && revision.sourcePrompt) result = upsertChatEntry(result, {
      id: `revision:${revision.id}:prompt`, role: "user", kind: "message", revisionId: revision.id,
      text: revision.sourcePrompt, createdAt: revision.createdAt,
    });
    result = upsertChatEntry(result, { id: `revision:${revision.id}`, role: "assistant", kind: "result",
      text: revision.summary, createdAt: revision.createdAt, revisionId: revision.id,
      details: [`Saved revision v${revision.version}. Open it to inspect files and verification.`], state: "done" });
  }
  return { ...result, entries: result.entries.toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)) };
}

// Report only observed evidence; a pending result or elapsed time is never a successful build.
export function generationActivity(result: GenerationStatus): string[] {
  const lines: string[] = [];
  if (result.status === "ready" || result.hasSavedResult) lines.push("Generated output saved by Project Service.");
  if (result.status === "ready") {
    lines.push(result.buildVerification ? "Static build passed for this snapshot." : "Static build not verified for this revision.");
    lines.push(`Revision v${result.revisionVersion} published.`);
  } else if (result.status === "failed") lines.push(`Attempt failed: ${result.errorCode ?? "GENERATION_FAILED"}. Saved files are unchanged.`);
  return lines;
}
