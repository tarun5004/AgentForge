import { Schema, Types, model } from "mongoose";

export type GeneratedFile = {
  path: string;
  content: string;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type GenerationResult = {
  provider: string;
  model: string;
  summary: string;
  files: GeneratedFile[];
  usage: TokenUsage;
  latencyMs: number;
};

export type GenerationStatus = "pending" | "ready" | "failed";

export type GenerationDocument = {
  projectId: Types.ObjectId;
  ownerId: string;
  idempotencyKey: string;
  status: GenerationStatus;
  result?: GenerationResult;
  revisionId?: Types.ObjectId;
  errorCode?: string;
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
  },
  { _id: false },
);

const generationSchema = new Schema<GenerationDocument>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    ownerId: { type: String, required: true, index: true },
    idempotencyKey: { type: String, required: true, maxlength: 100 },
    status: {
      type: String,
      enum: ["pending", "ready", "failed"],
      default: "pending",
    },
    result: { type: generationResultSchema, required: false },
    revisionId: { type: Schema.Types.ObjectId, ref: "Revision" },
    errorCode: { type: String },
  },
  { timestamps: true },
);

generationSchema.index({ projectId: 1, idempotencyKey: 1 }, { unique: true });
generationSchema.index({ ownerId: 1, createdAt: -1 });

export const Generation = model<GenerationDocument>("Generation", generationSchema);
