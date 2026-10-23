import { Schema, Types, model } from "mongoose";
import type { BuildVerification } from "../clients/build-verification.js";

export type GeneratedFile = {
  path: string;
  content: string;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type GeneratedFileChange = { path: string; status: "A" | "M" | "D" };
export type ManifestValidation = { policyVersion: "frontend-manifest-v1"; status: "manifest_validated" };

export type GenerationResult = {
  provider: string;
  model: string;
  summary: string;
  files: GeneratedFile[];
  usage: TokenUsage;
  latencyMs: number;
  fileChanges?: GeneratedFileChange[];
  validation?: ManifestValidation;
};

export type GenerationStatus = "pending" | "ready" | "failed";

export type GenerationDocument = {
  projectId: Types.ObjectId;
  ownerId: string;
  idempotencyKey: string;
  sourcePrompt?: string;
  baseRevisionId?: Types.ObjectId | null;
  requestFingerprint?: string;
  expectedVersion?: number;
  requestPolicyVersion?: string;
  buildPolicyVersion?: "next-static-build-v1";
  buildVerification?: BuildVerification;
  status: GenerationStatus;
  result?: GenerationResult;
  revisionId?: Types.ObjectId;
  errorCode?: string;
  completedAt?: Date;
  failedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const generatedFileSchema = new Schema<GeneratedFile>(
  {
    path: { type: String, required: true },
    content: { type: String, required: true },
  },
  { _id: false },
);

// Reused by Generation and Revision; missing legacy metadata stays unknown, not an empty diff.
export const fileChangeSchema = new Schema<GeneratedFileChange>({
  path: { type: String, required: true, maxlength: 120 },
  status: { type: String, required: true, enum: ["A", "M", "D"] },
}, { _id: false });
export const manifestValidationSchema = new Schema<ManifestValidation>({
  policyVersion: { type: String, required: true, enum: ["frontend-manifest-v1"] },
  status: { type: String, required: true, enum: ["manifest_validated"] },
}, { _id: false });

// The complete proof is stored, not just a boolean that could refer to different source bytes.
export const buildEvidenceSchema = new Schema<BuildVerification>({
  status: { type: String, required: true, enum: ["build_passed"] },
  policyVersion: { type: String, required: true, enum: ["next-static-build-v1"] },
  snapshotHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  runnerImageId: { type: String, required: true, match: /^sha256:[a-f0-9]{64}$/ },
  checkId: { type: String, required: true }, completedAt: { type: String, required: true },
}, { _id: false });

const generationResultSchema = new Schema<GenerationResult>(
  {
    provider: { type: String, required: true },
    model: { type: String, required: true },
    summary: { type: String, required: true },
    files: { type: [generatedFileSchema], required: true },
    usage: {
      inputTokens: { type: Number, required: true, min: 0 },
      outputTokens: { type: Number, required: true, min: 0 },
      totalTokens: { type: Number, required: true, min: 0 },
    },
    latencyMs: { type: Number, required: true, min: 0 },
    fileChanges: { type: [fileChangeSchema], default: undefined },
    validation: { type: manifestValidationSchema, required: false },
  },
  { _id: false },
);

const generationSchema = new Schema<GenerationDocument>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    ownerId: { type: String, required: true, index: true },
    idempotencyKey: { type: String, required: true, maxlength: 100 },
    // Optional for old records; new attempts save immutable intent before spending model tokens.
    sourcePrompt: { type: String, minlength: 10, maxlength: 1000, immutable: true },
    baseRevisionId: { type: Schema.Types.ObjectId, ref: "Revision", immutable: true },
    requestFingerprint: { type: String, match: /^[a-f\d]{64}$/, immutable: true },
    expectedVersion: { type: Number, min: 1, immutable: true },
    requestPolicyVersion: { type: String, enum: ["generation-request-v1"], immutable: true },
    buildPolicyVersion: { type: String, enum: ["next-static-build-v1"], immutable: true },
    buildVerification: { type: buildEvidenceSchema, required: false },
    status: {
      type: String,
      enum: ["pending", "ready", "failed"],
      default: "pending",
    },
    result: { type: generationResultSchema, required: false },
    revisionId: { type: Schema.Types.ObjectId, ref: "Revision" },
    errorCode: { type: String },
    completedAt: { type: Date },
    failedAt: { type: Date },
  },
  { timestamps: true },
);

generationSchema.index({ projectId: 1, idempotencyKey: 1 }, { unique: true });
generationSchema.index({ ownerId: 1, createdAt: -1 });

export const Generation = model<GenerationDocument>("Generation", generationSchema);
