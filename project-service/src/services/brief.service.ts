import { Types } from "mongoose";
import { requestAssessment } from "../clients/requirement.client.js";
import {
  briefFingerprint,
  parseBriefSubmission,
  prepareRequirementRequest,
  questionIdentity,
  type BriefSubmission,
} from "../clients/requirement.contract.js";
import { AppError } from "../middlewares/error.middleware.js";
import type { BriefRecord } from "../models/project-brief.model.js";
import * as briefs from "../repositories/brief.repository.js";
import { findOwnedProject } from "../repositories/project.repository.js";
import { findGenerationByKey } from "../repositories/generation.repository.js";
import { createGeneration } from "./generation.service.js";
import { validateIdempotencyKey } from "./generation-request.js";
import { validateObjectId } from "./project-read.validation.js";

// Owner identity always comes from JWT middleware, not from any browser-supplied brief fields.
async function ownedProject(ownerId: string, rawProjectId: unknown) {
  const id = validateObjectId(rawProjectId, "projectId");
  const project = await findOwnedProject(id, ownerId);
  if (!project) throw new AppError(404, "Project not found.");
  return project;
}

// Explicit fields hide request fingerprints/keys and database internals from the browser.
export function publicBrief(record: BriefRecord) {
  return {
    id: record._id.toString(),
    version: record.version,
    sourcePrompt: record.sourcePrompt,
    answers: record.answers.map((item) => ({ question: item.question, answer: item.answer })),
    status: record.status,
    assessment: record.assessment,
    confirmedAt: record.confirmedAt?.toISOString() ?? null,
    errorCode: record.errorCode,
    createdAt: record.createdAt.toISOString(),
  };
}

// Read-only recovery never resumes work or consumes model tokens.
export async function getBrief(ownerId: string, projectId: unknown) {
  const project = await ownedProject(ownerId, projectId);
  const record = await briefs.latestBrief(project.id);
  return record ? publicBrief(record) : null;
}

// Replays resolve before current-version checks, preserving old completed attempts after newer edits.
function replay(record: BriefRecord, fingerprint: string) {
  if (record.requestFingerprint !== fingerprint) {
    throw new AppError(409, "This key belongs to another brief request.", "IDEMPOTENCY_MISMATCH");
  }
  if (record.status === "pending") {
    throw new AppError(409, "Assessment is pending; read its status before retrying.", "BRIEF_IN_PROGRESS");
  }
  return publicBrief(record);
}

// Answers must refer to server-recorded questions and preserve earlier facts; updates are explicit.
function validateAnswerHistory(submission: BriefSubmission, previous: BriefRecord | null) {
  const recordedQuestions = [
    ...(previous?.answers.map((item) => item.question) ?? []),
    ...(previous?.assessment?.questions ?? []),
  ];
  const allowed = new Set(recordedQuestions.map(questionIdentity));
  const supplied = new Set(submission.answers.map((item) => questionIdentity(item.question)));
  const hasUnknownQuestion = submission.answers.some((item) => !allowed.has(questionIdentity(item.question)));
  const droppedEarlierAnswer = previous?.answers.some((item) => !supplied.has(questionIdentity(item.question)));
  if (hasUnknownQuestion || droppedEarlierAnswer) {
    throw new AppError(400, "Answer only recorded questions and retain earlier answers.", "INVALID_BRIEF_ANSWERS");
  }
}

// Reserve one durable version before one upstream call; no queue, transaction or automatic paid retry.
export async function assessProjectBrief(ownerId: string, rawProjectId: unknown, rawKey: unknown, body: unknown) {
  const submission = parseBriefSubmission(body);
  const key = validateIdempotencyKey(rawKey);
  const project = await ownedProject(ownerId, rawProjectId);
  const fingerprint = briefFingerprint(project.id, project.initialPrompt, submission);
  const existing = await briefs.briefByKey(project.id, key);
  if (existing) return replay(existing, fingerprint);
  const head = await briefs.latestBrief(project.id);
  // The winner may have finished between our first key lookup and the head read.
  if ((head?.version ?? 0) !== submission.expectedVersion || head?.status === "pending") {
    const winner = await briefs.briefByKey(project.id, key);
    if (winner) return replay(winner, fingerprint);
  }
  if (head?.status === "pending") {
    throw new AppError(409, "Read or explicitly abandon the pending assessment first.", "BRIEF_IN_PROGRESS");
  }
  if ((head?.version ?? 0) !== submission.expectedVersion) {
    throw new AppError(409, "Brief changed; reload before submitting.", "BRIEF_VERSION_CONFLICT");
  }
  const previous = await briefs.latestCompletedBrief(project.id);
  validateAnswerHistory(submission, previous);
  const request = prepareRequirementRequest(project.id, project.initialPrompt, submission, new Types.ObjectId().toString());
  let record: BriefRecord;
  try {
    record = await briefs.insertBrief(
      project.id, submission.expectedVersion + 1, key, fingerprint, project.initialPrompt, submission.answers,
    );
  } catch (error) {
    // An uncertain insert may have succeeded. Reread before reporting failure or making any call.
    let winner;
    try {
      winner = await briefs.briefByKey(project.id, key);
    } catch {
      throw new AppError(503, "Brief reservation outcome is unknown; preserve the key and reload.", "OUTCOME_UNKNOWN");
    }
    if (winner) return replay(winner, fingerprint);
    if (briefs.isBriefDuplicate(error)) {
      throw new AppError(409, "Another assessment reserved this version.", "BRIEF_VERSION_CONFLICT");
    }
    throw new AppError(503, "Brief reservation outcome is unknown; preserve the key and reload.", "OUTCOME_UNKNOWN");
  }
  request.requestId = record._id.toString();
  let assessment;
  try {
    assessment = await requestAssessment(request);
  } catch {
    // A submitted upstream request might have consumed tokens. The same key must not retry it.
    try {
      await briefs.failBrief(record._id.toString(), "ASSESSMENT_OUTCOME_UNKNOWN");
    } catch {
      // GET/replay still exposes the durable pending intent when failure recording is unavailable.
    }
    throw new AppError(502, "Requirement assessment failed or its response is unknown. Reload before a deliberate new attempt.", "ASSESSMENT_OUTCOME_UNKNOWN");
  }
  try {
    const saved = await briefs.completeBrief(record._id.toString(), assessment);
    if (saved) return publicBrief(saved);
    const ended = await briefs.briefById(project.id, record._id.toString());
    if (ended) return publicBrief(ended);
  } catch {
    // A lost write acknowledgement is not proof of failure; recover an already committed result.
    try {
      const saved = await briefs.briefById(project.id, record._id.toString());
      if (saved && saved.status !== "pending") return publicBrief(saved);
    } catch {
      // GET/replay remains the recovery path when MongoDB is unavailable.
    }
  }
  throw new AppError(503, "Assessment persistence outcome is unknown; preserve the key and reload.", "OUTCOME_UNKNOWN");
}

// Only the current owned version may be confirmed, abandoned or used for a new generation.
async function currentBrief(ownerId: string, projectId: unknown, rawBriefId: unknown) {
  const project = await ownedProject(ownerId, projectId);
  const id = validateObjectId(rawBriefId, "briefId");
  const record = await briefs.briefById(project.id, id);
  if (!record) throw new AppError(404, "Brief not found.");
  const head = await briefs.latestBrief(project.id);
  if (head?._id.toString() !== id) {
    throw new AppError(409, "Brief changed; reload the current version.", "BRIEF_VERSION_CONFLICT");
  }
  return record;
}

// This is human consent for this exact stored snapshot, never a model-supplied ready flag alone.
export async function confirmProjectBrief(ownerId: string, projectId: unknown, briefId: unknown) {
  const record = await currentBrief(ownerId, projectId, briefId);
  if (record.status !== "completed" || record.assessment?.status !== "ready") {
    throw new AppError(409, "This brief is not ready for confirmation.", "BRIEF_NOT_READY");
  }
  const confirmed = record.confirmedAt ? record : await briefs.confirmBrief(record._id.toString());
  const latest = await currentBrief(ownerId, projectId, briefId);
  if (!confirmed && !latest.confirmedAt) throw new AppError(409, "Brief confirmation changed; reload.", "BRIEF_VERSION_CONFLICT");
  return publicBrief(latest);
}

// Explicit abandonment unblocks a crashed request but cannot undo a possible upstream charge.
export async function abandonProjectBrief(ownerId: string, projectId: unknown, briefId: unknown) {
  const record = await currentBrief(ownerId, projectId, briefId);
  if (record.status !== "pending") throw new AppError(409, "Only a pending assessment can be abandoned.", "BRIEF_NOT_PENDING");
  const ended = await briefs.failBrief(record._id.toString(), "ASSESSMENT_ABANDONED");
  if (!ended) throw new AppError(409, "Assessment already finished; reload.", "BRIEF_VERSION_CONFLICT");
  return publicBrief(ended);
}

// New work requires current confirmation; retries of an existing generation retain its frozen brief.
export async function generateFromBrief(ownerId: string, rawProjectId: unknown, rawBriefId: unknown, rawKey: unknown, authorization: string) {
  const project = await ownedProject(ownerId, rawProjectId);
  const id = validateObjectId(rawBriefId, "briefId");
  const key = validateIdempotencyKey(rawKey);
  const record = await briefs.briefById(project.id, id);
  if (!record) throw new AppError(404, "Brief not found.");
  if (!record.confirmedAt || record.assessment?.status !== "ready") {
    throw new AppError(409, "Confirm a ready brief before generating.", "BRIEF_NOT_CONFIRMED");
  }
  const existingGeneration = await findGenerationByKey(project.id, ownerId, key);
  if (!existingGeneration) await currentBrief(ownerId, project.id, id);
  return createGeneration(ownerId, project.id, key, { prompt: record.assessment.brief }, authorization);
}
