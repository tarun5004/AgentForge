import { Schema, Types, model } from "mongoose";

import {
  fileChangeSchema, manifestValidationSchema, buildEvidenceSchema,
  type GeneratedFile, type GeneratedFileChange, type ManifestValidation, type TokenUsage,
} from "./generation.model.js";
import type { BuildVerification } from "../clients/build-verification.js";

export type RevisionDocument = {
  projectId: Types.ObjectId;
  generationId: Types.ObjectId;
  version: number;
  summary: string;
  files: GeneratedFile[];
  parentRevisionId?: Types.ObjectId | null;
  sourcePrompt?: string;
  fileChanges?: GeneratedFileChange[];
  provider?: string;
  model?: string;
  usage?: TokenUsage;
  latencyMs?: number;
  validation?: ManifestValidation;
  schemaVersion?: number;
  buildVerification?: BuildVerification;
  createdAt: Date;
  updatedAt: Date;
};

const revisionFileSchema = new Schema<GeneratedFile>(
  {
    path: { type: String, required: true },
    content: { type: String, required: true },
  },
  { _id: false },
);

const revisionSchema = new Schema<RevisionDocument>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true, immutable: true },
    generationId: {
      type: Schema.Types.ObjectId,
      ref: "Generation",
      required: true,
      unique: true,
      immutable: true,
    },
    version: { type: Number, required: true, min: 1, immutable: true },
    summary: { type: String, required: true, maxlength: 240, immutable: true },
    files: { type: [revisionFileSchema], required: true, immutable: true },
    // Optional for legacy reads. New snapshots record all provenance without any backfill.
    parentRevisionId: { type: Schema.Types.ObjectId, ref: "Revision", immutable: true },
    sourcePrompt: { type: String, minlength: 10, maxlength: 1000, immutable: true },
    fileChanges: { type: [fileChangeSchema], default: undefined, immutable: true },
    provider: { type: String, maxlength: 100, immutable: true },
    model: { type: String, maxlength: 200, immutable: true },
    usage: { type: new Schema<TokenUsage>({
      inputTokens: { type: Number, required: true, min: 0 },
      outputTokens: { type: Number, required: true, min: 0 },
      totalTokens: { type: Number, required: true, min: 0 },
    }, { _id: false }), immutable: true },
    latencyMs: { type: Number, min: 0, immutable: true },
    validation: { type: manifestValidationSchema, immutable: true },
    schemaVersion: { type: Number, enum: [2], immutable: true },
    buildVerification: { type: buildEvidenceSchema, immutable: true },
  },
  { timestamps: true },
);

revisionSchema.index({ projectId: 1, version: 1 }, { unique: true });

export const Revision = model<RevisionDocument>("Revision", revisionSchema);
