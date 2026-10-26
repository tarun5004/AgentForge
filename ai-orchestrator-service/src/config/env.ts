import dotenv from "dotenv";
import { readAISettings } from "./ai-settings.js";

dotenv.config();

// Required internal credentials stay server-side regardless of the selected model provider.
function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const aiSettings = readAISettings(process.env);

const port = Number.parseInt(process.env.PORT ?? "6001", 10);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PORT must be a positive integer.");
}

// A server can listen on 6000, but Node Fetch refuses to call it.
if (port === 6000) throw new Error("PORT 6000 is blocked by Fetch. Use PORT=6001.");

export const env = {
  PORT: port,
  INTERNAL_SERVICE_TOKEN: getRequiredEnv("INTERNAL_SERVICE_TOKEN"),
  ...aiSettings,
};
