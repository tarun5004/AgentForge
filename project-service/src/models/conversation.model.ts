import { Schema, model } from "mongoose";
import type { ConversationResponse } from "../clients/conversation.stream.js";

export type ChatTurn = {
  key: string; message: string; projectId: string | null; baseRevisionId: string | null;
  status: "pending" | "complete" | "interrupted"; response: ConversationResponse | null; createdAt: Date;
};
export type ConversationRecord = {
  ownerId: string; title: string; projectId: string | null; turns: ChatTurn[]; createdAt: Date; updatedAt: Date;
};
const turnSchema = new Schema<ChatTurn>({
  key: { type: String, required: true, maxlength: 100 }, message: { type: String, required: true, maxlength: 1000 },
  projectId: { type: String, default: null }, baseRevisionId: { type: String, default: null },
  status: { type: String, enum: ["pending", "complete", "interrupted"], required: true },
  response: { type: Schema.Types.Mixed, default: null }, createdAt: { type: Date, required: true },
}, { _id: false });
// A hard 100-turn cap keeps all admission/completion writes atomic on standalone Mongo, without a queue/transaction.
const schema = new Schema<ConversationRecord>({
  ownerId: { type: String, required: true }, title: { type: String, required: true, maxlength: 80 },
  projectId: { type: String, default: null }, turns: { type: [turnSchema], default: [], validate: (turns: ChatTurn[]) => turns.length <= 100 },
}, { timestamps: true });
schema.index({ ownerId: 1, _id: -1 });
export const Conversation = model<ConversationRecord>("Conversation", schema);
