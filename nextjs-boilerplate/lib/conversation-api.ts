import { ProjectApiError } from "./project-api.ts";
import { requestWithSession, type ProjectAccess } from "./session-request.ts";
import type { ChatEntry } from "./conversation.ts";

export type ConversationMessage = { role: "user" | "assistant"; content: string };
export type ConversationResponse = {
  requestId: string; action: "reply" | "clarify" | "build"; message: string; prompt: string | null;
  sources: { id: string; title: string }[];
  retrieval: { method: "lexical" | "semantic"; embeddingModel: string | null; inputTokens: number | null };
  model: string; usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
  latencyMs: number;
};

// Send recent conversation, not status updates, source code, or private service credentials.
export function conversationContext(entries: ChatEntry[], text: string) {
  const previous = entries.filter((entry) => entry.kind !== "activity").map((entry) => ({
    role: entry.role, content: entry.kind === "requirements" ? [entry.text, ...(entry.details ?? [])].join("\n") : entry.text,
  })).filter((message) => message.content.length <= 4000);
  const messages: ConversationMessage[] = [...previous, { role: "user", content: text }];
  const originalLength = messages.length;
  while (messages.length > 16 || new TextEncoder().encode(JSON.stringify(messages)).length > 16_000) {
    if (messages.length === 1) throw new Error("Message exceeds the conversation limit.");
    messages.shift();
  }
  return { messages, trimmed: messages.length !== originalLength };
}

// Runtime validation prevents malformed model metadata from becoming a build action.
export function isConversationResponse(value: unknown): value is ConversationResponse {
  if (!value || typeof value !== "object") return false;
  const item = value as ConversationResponse;
  const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
  const count = (value: unknown) => value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
  return text(item.requestId, 100) && ["reply", "clarify", "build"].includes(item.action) && text(item.message, 4000) &&
    (item.action === "build" ? text(item.prompt, 1000) && item.prompt!.trim().length >= 10 : item.prompt === null) &&
    Array.isArray(item.sources) && item.sources.length <= 8 && item.sources.every((source) => source && text(source.id, 100) && text(source.title, 200)) &&
    !!item.retrieval && ["lexical", "semantic"].includes(item.retrieval.method) &&
    (item.retrieval.embeddingModel === null || text(item.retrieval.embeddingModel, 200)) && count(item.retrieval.inputTokens) &&
    text(item.model, 200) && !!item.usage && count(item.usage.inputTokens) && count(item.usage.outputTokens) && count(item.usage.totalTokens) &&
    typeof item.latencyMs === "number" && Number.isFinite(item.latencyMs) && item.latencyMs >= 0;
}

// Only an explicit send starts AI; ambiguous failures are never automatically replayed.
export async function sendConversation(
  body: { messages: ConversationMessage[]; projectId?: string; baseRevisionId?: string }, access: ProjectAccess,
) {
  const result = await requestWithSession("/api/conversations", access, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(55_000),
  });
  const payload = await result.json().catch(() => null);
  if (!result.ok) throw new ProjectApiError(typeof payload?.message === "string" ? payload.message : "Could not get an AI reply. Your saved files are unchanged.", result.status, payload?.code);
  if (!isConversationResponse(payload?.response)) throw new Error("AI returned an invalid reply. No generation was started.");
  return payload.response;
}

// Missing usage is unknown, never zero; retrieved sources and model calls are visible evidence.
export function conversationReport(response: ConversationResponse): string[] {
  return [
    `Model: ${response.model} · ${response.usage.totalTokens ?? "unknown"} tokens · ${response.latencyMs} ms`,
    `Decision: ${response.action} · Retrieval: ${response.retrieval.method}${response.retrieval.embeddingModel ? ` (${response.retrieval.embeddingModel})` : " (local, no embedding API call)"}`,
    ...response.sources.map((source) => `Source: ${source.id} — ${source.title}`),
  ];
}
