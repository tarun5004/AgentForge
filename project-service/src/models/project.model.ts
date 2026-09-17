import { Schema, model } from "mongoose";

export type ProjectStatus = "draft" | "generating" | "ready" | "failed";

export type ProjectDocument = {
  ownerId: string;
  name: string;
  initialPrompt: string;
  template: "nextjs";
  status: ProjectStatus;
  currentRevisionNumber: number;
  createdAt: Date;
  updatedAt: Date;
};

const projectSchema = new Schema<ProjectDocument>(
  {
    ownerId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    initialPrompt: { type: String, required: true, trim: true, maxlength: 1000 },
    template: { type: String, enum: ["nextjs"], default: "nextjs" },
    status: {
      type: String,
      enum: ["draft", "generating", "ready", "failed"],
      default: "draft",
    },
    currentRevisionNumber: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

projectSchema.index({ ownerId: 1, createdAt: -1 });

export const Project = model<ProjectDocument>("Project", projectSchema);
