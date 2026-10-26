import { z } from "zod";
import { AppError } from "../middlewares/error.middleware.js";
import type { ConversationRecord } from "../models/conversation.model.js";
import * as repository from "../repositories/conversation.repository.js";
import { findOwnedProjectForRead } from "../repositories/project.repository.js";
import { prepareConversation } from "./conversation.service.js";
import { requestConversationStream, type ConversationEvent } from "../clients/conversation.stream.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i).transform((id) => id.toLowerCase());
const turnInput = z.strictObject({
  key: z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/), message: z.string().trim().min(1).max(1000),
  projectId: objectId.optional(), baseRevisionId: objectId.optional(),
});

// Zod details remain internal; callers receive one consistent public validation error.
export function parseChatInput(value: unknown) {
  const parsed = turnInput.safeParse(value);
  if (!parsed.success || (parsed.data.baseRevisionId && !parsed.data.projectId)) throw new AppError(400, "Invalid chat turn.", "INVALID_CONVERSATION");
  return parsed.data;
}

// Serialization omits owner identity while preserving exact persisted text and outcome metadata.
export function serializeConversation(record: ConversationRecord & { _id: unknown }, before = record.turns.length) {
  const end = Math.min(before, record.turns.length);
  const start = Math.max(0, end - 20);
  return { id: String(record._id), title: record.title, projectId: record.projectId,
    createdAt: record.createdAt, updatedAt: record.updatedAt, turns: record.turns.slice(start, end),
    turnCount: record.turns.length, nextBefore: start > 0 ? start : null };
}

// A saved chat is not a generated project; listing and reading it never invoke a model.
export async function getOwnedConversation(id: string, ownerId: string) {
  const record = await repository.findConversation(id, ownerId);
  if (!record) throw new AppError(404, "Conversation not found.");
  return record;
}

// Only a project belonging to this account may be attached after the first explicit build.
export async function attachProject(id: string, ownerId: string, projectId: string) {
  if (!await findOwnedProjectForRead(projectId, ownerId)) throw new AppError(404, "Project not found.");
  const record = await repository.linkConversationProject(id, ownerId, projectId);
  if (!record) throw new AppError(409, "Conversation is unavailable or already linked to another project.");
  return serializeConversation(record);
}

// Store all bounded turns, but send only completed recent pairs within the existing model-context budget.
export function savedConversationContext(record: ConversationRecord, message: string) {
  const messages: { role: "user" | "assistant"; content: string }[] = record.turns
    .filter((turn) => turn.status === "complete" && turn.response)
    .flatMap((turn) => [{ role: "user" as const, content: turn.message }, { role: "assistant" as const, content: turn.response!.message }]);
  messages.push({ role: "user", content: message });
  const length = messages.length;
  while (messages.length > 16 || Buffer.byteLength(JSON.stringify(messages)) > 16_000) messages.shift();
  return { messages, trimmed: messages.length < length };
}

// Reserve before inference; replaying a completed key reads storage, not another provider attempt.
export async function prepareSavedTurn(id: string, ownerId: string, body: unknown) {
  const input = parseChatInput(body);
  const record = await getOwnedConversation(id, ownerId);
  const previous = record.turns.find((turn) => turn.key === input.key);
  if (previous) {
    if (previous.message !== input.message || previous.projectId !== (input.projectId ?? null) || previous.baseRevisionId !== (input.baseRevisionId ?? null)) {
      throw new AppError(409, "Request key belongs to a different message or base.", "IDEMPOTENCY_MISMATCH");
    }
    if (previous.status === "complete" && previous.response) return { input, replay: previous.response, request: null, trimmed: false };
    throw new AppError(409, "Turn is pending or interrupted. Read history before a deliberate new request.", "CHAT_OUTCOME_UNKNOWN");
  }
  if (record.projectId && record.projectId !== input.projectId) throw new AppError(409, "Use this conversation's linked project.");
  const context = savedConversationContext(record, input.message);
  const request = await prepareConversation(ownerId, { messages: context.messages,
    ...(input.projectId ? { projectId: input.projectId } : {}), ...(input.baseRevisionId ? { baseRevisionId: input.baseRevisionId } : {}) });
  request.requestId = `${id}:${input.key}`;
  await repository.expireConversationTurns(id, ownerId);
  const reserved = await repository.reserveConversationTurn(id, ownerId, {
    key: input.key, message: input.message, projectId: input.projectId ?? null, baseRevisionId: input.baseRevisionId ?? null,
    status: "pending", response: null, createdAt: new Date(),
  });
  if (!reserved) throw new AppError(409, "Another turn is active, the key is already reserved, or the 100-turn limit was reached.", "CHAT_BUSY_OR_FULL");
  // Another completed turn may have arrived between the read and reservation; rebuild from the reserved snapshot.
  const reservedContext = savedConversationContext(reserved, input.message);
  request.messages = reservedContext.messages;
  return { input, request, replay: null, trimmed: reservedContext.trimmed };
}

// Completion is saved before it can reach a browser; interruption never overwrites a durable success.
export async function* runSavedTurn(id: string, ownerId: string, prepared: Awaited<ReturnType<typeof prepareSavedTurn>>, signal: AbortSignal): AsyncGenerator<ConversationEvent> {
  if (prepared.replay) { yield { event: "complete", response: prepared.replay }; return; }
  try {
    for await (const event of requestConversationStream(prepared.request!, signal)) {
      if (event.event === "complete") {
        const saved = await repository.completeConversationTurn(id, ownerId, prepared.input.key, event.response);
        if (!saved.modifiedCount) throw new Error("Chat reservation expired before completion.");
      }
      yield event;
    }
  } catch (error) {
    await repository.interruptConversationTurn(id, ownerId, prepared.input.key).catch(() => undefined);
    throw error;
  }
}
