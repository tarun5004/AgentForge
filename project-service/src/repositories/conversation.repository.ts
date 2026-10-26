import { Types } from "mongoose";
import { Conversation, type ChatTurn } from "../models/conversation.model.js";
import type { ConversationResponse } from "../clients/conversation.stream.js";

// Conversation identity exists before any model call and is independent of a generated project.
export function insertConversation(ownerId: string) {
  return Conversation.create({ ownerId, title: "New conversation" });
}

// Scope every lookup to the verified JWT owner, including project-independent chat history.
export function findConversation(id: string, ownerId: string) {
  return Conversation.findOne({ _id: id, ownerId }).lean();
}

// The stable ID cursor avoids growing skip scans; never load message bodies for the sidebar.
export function listConversations(ownerId: string, before?: string) {
  return Conversation.find({ ownerId, ...(before ? { _id: { $lt: new Types.ObjectId(before) } } : {}) })
    .select("title projectId createdAt updatedAt").sort({ _id: -1 }).limit(21).lean();
}

// Mark abandoned calls unknown; this never restarts provider work or claims it was free.
export function expireConversationTurns(id: string, ownerId: string) {
  return Conversation.updateOne({ _id: id, ownerId }, { $set: { "turns.$[turn].status": "interrupted" } }, {
    arrayFilters: [{ "turn.status": "pending", "turn.createdAt": { $lt: new Date(Date.now() - 75_000) } }],
  });
}

// One atomic predicate enforces unique request keys, serial turns and the storage cap without transactions.
export function reserveConversationTurn(id: string, ownerId: string, turn: ChatTurn) {
  return Conversation.findOneAndUpdate({ _id: id, ownerId,
    "turns.key": { $ne: turn.key }, turns: { $not: { $elemMatch: { status: "pending" } } },
    $expr: { $lt: [{ $size: "$turns" }, 100] },
  }, { $push: { turns: turn }, $set: { title: turn.message.slice(0, 80) } }, { returnDocument: "after" }).lean();
}

// A completed reply is durable before SSE completion; stale/expired reservations cannot overwrite history.
export function completeConversationTurn(id: string, ownerId: string, key: string, response: ConversationResponse) {
  return Conversation.updateOne({ _id: id, ownerId, turns: { $elemMatch: { key, status: "pending" } } },
    { $set: { "turns.$.status": "complete", "turns.$.response": response } });
}

// Only a still-pending attempt can become interrupted, preserving a saved success after a lost response.
export function interruptConversationTurn(id: string, ownerId: string, key: string) {
  return Conversation.updateOne({ _id: id, ownerId, turns: { $elemMatch: { key, status: "pending" } } }, { $set: { "turns.$.status": "interrupted" } });
}

// Linking is owner-checked by the service; another project must never silently adopt this thread.
export function linkConversationProject(id: string, ownerId: string, projectId: string) {
  return Conversation.findOneAndUpdate({ _id: id, ownerId, $or: [{ projectId: null }, { projectId }] }, { $set: { projectId } }, { returnDocument: "after" }).lean();
}
