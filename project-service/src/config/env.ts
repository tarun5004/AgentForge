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

// Gate rollout is explicit; malformed configuration must not silently disable verification.
const buildGate = process.env.BUILD_GATE_ENABLED ?? "false";
if (!["true", "false"].includes(buildGate)) throw new Error("BUILD_GATE_ENABLED must be true or false.");
const checkToken = process.env.EXECUTION_CHECK_TOKEN;
if (checkToken !== undefined && (!/^[A-Za-z0-9_-]{32,256}$/.test(checkToken) ||
  checkToken === process.env.ACCESS_TOKEN_SECRET?.trim() || checkToken === process.env.INTERNAL_SERVICE_TOKEN?.trim())) {
  throw new Error("EXECUTION_CHECK_TOKEN must be a separate 32-256 character URL-safe secret.");
}
if (buildGate === "true" && !checkToken) throw new Error("Build gate requires EXECUTION_CHECK_TOKEN.");
if (buildGate === "true" && nodeEnv === "production") throw new Error("Local build gate is not approved for public production.");
// Reject nonlocal targets with a fixed error, without echoing possibly sensitive URL text.
function executionOrigin(): string {
  try {
    const url = new URL(process.env.EXECUTION_SERVICE_URL ?? "http://127.0.0.1:5100");
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw new Error("EXECUTION_SERVICE_URL must be a loopback HTTP origin."); }
}

export const env = {
  PORT: port,
  NODE_ENV: nodeEnv as "development" | "production" | "test",
  MONGODB_URI: getRequiredEnv("MONGODB_URI"),
  ACCESS_TOKEN_SECRET: getRequiredEnv("ACCESS_TOKEN_SECRET"),
  AI_ORCHESTRATOR_URL:
    process.env.AI_ORCHESTRATOR_URL?.trim() || "http://localhost:6000",
  INTERNAL_SERVICE_TOKEN: getRequiredEnv("INTERNAL_SERVICE_TOKEN"),
  BUILD_GATE_ENABLED: buildGate === "true",
  EXECUTION_CHECK_TOKEN: checkToken,
  EXECUTION_SERVICE_URL: executionOrigin(),
};
