import mongoose from "mongoose";

import { env } from "./env.js";
import { ProjectBrief } from "../models/project-brief.model.js";

// Startup must establish both connectivity and the unique constraints used for brief admission.
export async function connectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(env.MONGODB_URI);
  }
  // Admission relies on unique indexes; do not accept HTTP work while they are still building.
  await ProjectBrief.init();
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
