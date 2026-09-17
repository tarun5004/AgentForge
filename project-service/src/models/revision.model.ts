import { Schema, Types, model } from "mongoose";

import type { GeneratedFile } from "./generation.model.js";

export type RevisionDocument = {
  projectId: Types.ObjectId;
  generationId: Types.ObjectId;
  version: number;
  summary: string;
  files: GeneratedFile[];
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
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    generationId: {
      type: Schema.Types.ObjectId,
      ref: "Generation",
      required: true,
      unique: true,
    },
    version: { type: Number, required: true, min: 1 },
    summary: { type: String, required: true, maxlength: 240 },
    files: { type: [revisionFileSchema], required: true },
  },
  { timestamps: true },
);

revisionSchema.index({ projectId: 1, version: 1 }, { unique: true });

export const Revision = model<RevisionDocument>("Revision", revisionSchema);
