import { model, Schema, Types } from "mongoose";
import type { BriefAssessment, BriefSubmission } from "../clients/requirement.contract.js";

export type BriefRecord = {
  _id: Types.ObjectId; projectId: Types.ObjectId; version: number; idempotencyKey: string; requestFingerprint: string;
  sourcePrompt: string; answers: BriefSubmission["answers"]; status: "pending" | "completed" | "failed";
  assessment: BriefAssessment | null; confirmedAt: Date | null; errorCode: string | null; createdAt: Date; updatedAt: Date;
};

const briefSchema = new Schema<BriefRecord>({
  projectId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  version: { type: Number, required: true, min: 1, immutable: true },
  idempotencyKey: { type: String, required: true, immutable: true },
  requestFingerprint: { type: String, required: true, immutable: true },
  sourcePrompt: { type: String, required: true, maxlength: 1000, immutable: true },
  answers: { type: [{ question: String, answer: String, _id: false }], required: true, immutable: true },
  status: { type: String, enum: ["pending", "completed", "failed"], default: "pending" },
  // Only independently validated upstream data reaches this field; Mixed preserves nullable usage.
  assessment: { type: Schema.Types.Mixed, default: null },
  confirmedAt: { type: Date, default: null }, errorCode: { type: String, default: null },
}, { timestamps: true });
// Reserving the next version is one atomic insert, suitable for standalone MongoDB as well.
briefSchema.index({ projectId: 1, version: 1 }, { unique: true });
briefSchema.index({ projectId: 1, idempotencyKey: 1 }, { unique: true });
export const ProjectBrief = model<BriefRecord>("ProjectBrief", briefSchema);
