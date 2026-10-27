import { ProjectApiError } from "./project-api.ts";
import { requestWithSession, type ProjectAccess } from "./session-request.ts";
import { isConversationResponse, conversationReport, type ConversationResponse } from "./conversation-api.ts";
import type { ChatEntry } from "./conversation.ts";

export type SavedTurn = { key: string; message: string; status: "pending" | "complete" | "interrupted"; response: ConversationResponse | null; createdAt: string };
export type SavedChatSummary = { id: string; title: string; projectId: string | null; createdAt: string; updatedAt: string };
export type SavedChat = SavedChatSummary & { turns: SavedTurn[]; turnCount: number; nextBefore: number | null };
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

// Public metadata is checked before it can construct a workspace URL or restore another thread's display.
function isSummary(value: unknown): value is SavedChatSummary {
  if (!value || typeof value !== "object") return false;
  const item = value as SavedChatSummary;
  return validId(item.id) && typeof item.title === "string" && item.title.length <= 80 &&
    (item.projectId === null || validId(item.projectId)) && Number.isFinite(Date.parse(item.createdAt)) && Number.isFinite(Date.parse(item.updatedAt));
}

// All history requests use the existing session refresh behavior; only a definite 401 can be retried.
async function chatJson(path: string, access: ProjectAccess, body?: unknown, signal?: AbortSignal) {
  const response = await requestWithSession(`/api/conversations${path}`, access, {
    cache: "no-store",
    method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ProjectApiError(data?.message ?? "Could not load saved conversation.", response.status, data?.code);
  return data;
}

// Read bounded server pages; browser caches are not the authoritative transcript.
export async function getSavedChat(id: string, access: ProjectAccess, signal?: AbortSignal, before?: number): Promise<SavedChat> {
  const { conversation } = await chatJson(`/${id}${before === undefined ? "" : `?before=${before}`}`, access, undefined, signal);
  if (!isSummary(conversation) || conversation.id !== id) throw new Error("Invalid saved conversation identity.");
  const saved = conversation as SavedChat;
  if (!Array.isArray(saved.turns) || saved.turns.length > 20 ||
      !Number.isInteger(saved.turnCount) || saved.turnCount < 0 || saved.turnCount > 100 ||
      !(saved.nextBefore === null || (Number.isInteger(saved.nextBefore) && saved.nextBefore >= 0 && saved.nextBefore <= 100)) ||
      !saved.turns.every((turn: SavedTurn) => typeof turn.key === "string" && turn.key.length <= 100 && typeof turn.message === "string" && turn.message.length <= 1000 &&
        ["pending", "complete", "interrupted"].includes(turn.status) && Number.isFinite(Date.parse(turn.createdAt)) &&
        (turn.status === "complete" ? isConversationResponse(turn.response) : turn.response === null))) throw new Error("Invalid saved conversation.");
  return saved;
}

// Listing conversations must never trigger inference, including in a fresh browser session.
export async function listSavedChats(access: ProjectAccess, signal?: AbortSignal, before?: string): Promise<{ conversations: SavedChatSummary[]; nextCursor: string | null }> {
  const data = await chatJson(before ? `?before=${before}` : "", access, undefined, signal);
  if (!Array.isArray(data?.conversations) || data.conversations.length > 20 || !data.conversations.every(isSummary) || !(data.nextCursor === null || validId(data.nextCursor))) throw new Error("Invalid saved conversation list.");
  return data;
}

// Create chat identity only on the first actual send, not on render or every greeting.
export async function createSavedChat(access: ProjectAccess): Promise<SavedChatSummary> {
  const { conversation } = await chatJson("/threads", access, {});
  if (!isSummary(conversation)) throw new Error("Invalid conversation identity.");
  return conversation;
}

// Keep generated files linked to their original chat without sending the display transcript back.
export async function linkChatProject(id: string, projectId: string, access: ProjectAccess) {
  await chatJson(`/${id}/project`, access, { projectId });
}

// Read actual SSE incrementally; provisional snapshots never authorize generation or auto-retry.
export async function streamSavedChat(id: string, body: { key: string; message: string; projectId?: string; baseRevisionId?: string }, access: ProjectAccess,
  onMessage: (message: string) => void, signal: AbortSignal): Promise<ConversationResponse> {
  const response = await requestWithSession(`/api/conversations/${id}/turns/stream`, access, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new ProjectApiError(error?.message ?? "Could not start chat response.", response.status, error?.code);
  }
  if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) throw new Error("Expected an AI response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let bytes = 0;
  let frames = 0;
  let started = false;
  let result: ConversationResponse | null = null;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1_650_000) throw new Error("AI stream exceeds its limit.");
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (++frames > 67 || frame.length > 32_000 || result) throw new Error("Invalid AI stream.");
        const [name, json, ...extra] = frame.split("\n");
        if (extra.length || !name?.startsWith("event: ") || !json?.startsWith("data: ")) throw new Error("Invalid AI event.");
        const data = JSON.parse(json.slice(6));
        if (name === "event: start" && !started && data?.conversationId === id && data?.key === body.key) { started = true; continue; }
        if (!started) throw new Error("Chat stream identity mismatch.");
        if (name === "event: message" && typeof data?.message === "string" && data.message.length <= 4000) onMessage(data.message);
        else if (name === "event: complete" && isConversationResponse(data?.response) && data.response.requestId === `${id}:${body.key}`) result = data.response;
        else throw new Error("Reply interrupted. Reload saved history before another attempt.");
      }
      if (buffer.length > 32_000) throw new Error("AI event exceeds its limit.");
    }
    buffer += decoder.decode();
    if (!result || buffer.trim()) throw new Error("Reply ended without confirmed completion. Reload saved history.");
    return result;
  } finally { await reader.cancel().catch(() => undefined); }
}

// Server-saved replies restore as display records; interrupted attempts are never treated as completed replies.
export function savedChatEntries(chat: SavedChat): ChatEntry[] {
  return chat.turns.flatMap((turn): ChatEntry[] => [
    { id: `chat:${turn.key}:user`, role: "user", kind: "message", text: turn.message, createdAt: turn.createdAt },
    turn.status === "complete" && turn.response
      ? { id: `chat:${turn.key}:assistant`, role: "assistant", kind: "message", text: turn.response.message, createdAt: turn.createdAt, state: "done", details: conversationReport(turn.response) }
      : { id: `chat:${turn.key}`, role: "assistant", kind: "activity", text: "Previous reply is pending or interrupted. No build was resumed.", createdAt: turn.createdAt, state: "unknown" },
  ]);
}
