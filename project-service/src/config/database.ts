import mongoose from "mongoose";

import { env } from "./env.js";

export async function connectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  await mongoose.connect(env.MONGODB_URI);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
