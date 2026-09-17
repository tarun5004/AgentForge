import dotenv from "dotenv";

dotenv.config();

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

if (!process.env.AI_GATEWAY_API_KEY?.trim() && !process.env.VERCEL_OIDC_TOKEN?.trim()) {
  throw new Error(
    "Missing AI Gateway authentication: set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.",
  );
}

const port = Number.parseInt(process.env.PORT ?? "6000", 10);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PORT must be a positive integer.");
}

export const env = {
  PORT: port,
  INTERNAL_SERVICE_TOKEN: getRequiredEnv("INTERNAL_SERVICE_TOKEN"),
  AI_MODEL: process.env.AI_MODEL?.trim() || "google/gemini-3.7-flash",
};
