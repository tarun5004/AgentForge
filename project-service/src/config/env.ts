import dotenv from "dotenv";

dotenv.config();

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const nodeEnv = process.env.NODE_ENV ?? "development";

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PORT must be a positive integer.");
}

if (!["development", "production", "test"].includes(nodeEnv)) {
  throw new Error("NODE_ENV must be development, production, or test.");
}

export const env = {
  PORT: port,
  NODE_ENV: nodeEnv as "development" | "production" | "test",
  MONGODB_URI: getRequiredEnv("MONGODB_URI"),
  ACCESS_TOKEN_SECRET: getRequiredEnv("ACCESS_TOKEN_SECRET"),
  AI_ORCHESTRATOR_URL:
    process.env.AI_ORCHESTRATOR_URL?.trim() || "http://localhost:6000",
  INTERNAL_SERVICE_TOKEN: getRequiredEnv("INTERNAL_SERVICE_TOKEN"),
};
