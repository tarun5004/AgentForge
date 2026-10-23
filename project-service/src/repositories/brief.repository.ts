import { mongo } from "mongoose";
import { ProjectBrief, type BriefRecord } from "../models/project-brief.model.js";
import type { BriefAssessment, BriefSubmission } from "../clients/requirement.contract.js";

// These scoped queries are used only after the service proves Project ownership.
export function latestBrief(projectId: string) {
  return ProjectBrief.findOne({ projectId }).sort({ version: -1 }).lean<BriefRecord | null>();
}
// A failed/pending turn must not erase the last questions that the user actually saw.
export function latestCompletedBrief(projectId: string) {
  return ProjectBrief.findOne({ projectId, status: "completed" }).sort({ version: -1 }).lean<BriefRecord | null>();
}
// Bind a request key to its original record, even after another version becomes current.
export function briefByKey(projectId: string, idempotencyKey: string) {
  return ProjectBrief.findOne({ projectId, idempotencyKey }).lean<BriefRecord | null>();
}
// Never look up an external brief ID without also constraining its parent project.
export function briefById(projectId: string, briefId: string) {
  return ProjectBrief.findOne({ _id: briefId, projectId }).lean<BriefRecord | null>();
}
// Persist request identity before calling the model; a racing insert cannot create the same version/key.
export async function insertBrief(projectId: string, version: number, key: string, fingerprint: string, prompt: string, answers: BriefSubmission["answers"]) {
  return (await ProjectBrief.create({ projectId, version, idempotencyKey: key, requestFingerprint: fingerprint, sourcePrompt: prompt, answers })).toObject<BriefRecord>();
}
// Only this collection's expected unique conflicts may be reconciled as request/version races.
export function isBriefDuplicate(error: unknown): boolean {
  if (!(error instanceof mongo.MongoServerError) || error.code !== 11000) return false;
  const keys = error.keyPattern as Record<string, number> | undefined;
  return !!keys && Object.keys(keys).length === 2 && keys.projectId === 1 && (keys.version === 1 || keys.idempotencyKey === 1);
}
// Compare-and-set prevents a late model response from reviving an explicitly abandoned attempt.
export function completeBrief(id: string, assessment: BriefAssessment) {
  return ProjectBrief.findOneAndUpdate({ _id: id, status: "pending" }, { $set: { status: "completed", assessment } }, { returnDocument: "after" }).lean<BriefRecord | null>();
}
// Failed outcomes retain their key and original input; a replay must not call the model again.
export function failBrief(id: string, errorCode: string) {
  return ProjectBrief.findOneAndUpdate({ _id: id, status: "pending" }, { $set: { status: "failed", errorCode } }, { returnDocument: "after" }).lean<BriefRecord | null>();
}
// The timestamp is written once, making a repeated confirmation idempotent.
export function confirmBrief(id: string) {
  return ProjectBrief.findOneAndUpdate({ _id: id, status: "completed", "assessment.status": "ready", confirmedAt: null },
    { $set: { confirmedAt: new Date() } }, { returnDocument: "after" }).lean<BriefRecord | null>();
}
