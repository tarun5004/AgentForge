import dotenv from "dotenv";

dotenv.config({ quiet: true });

const nodeEnvironments = ["development", "test", "production"] as const;
const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

type NodeEnvironment = (typeof nodeEnvironments)[number];
type LogLevel = (typeof logLevels)[number];

// Reject partial numeric strings instead of silently accepting a mistyped port.
function parsePort(value: string | undefined, fallback = "5000"): number {
  const port = Number(value ?? fallback);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
}

// Fail early when a deployment supplies an unsupported configuration value.
function parseEnum<T extends string>(
  name: string,
  value: string | undefined,
  allowedValues: readonly T[],
  fallback: T,
): T {
  const candidate = value ?? fallback;

  if (!allowedValues.includes(candidate as T)) {
    throw new Error(`${name} must be one of: ${allowedValues.join(", ")}`);
  }

  return candidate as T;
}

// Preserve the existing future-queue setting; local preview does not connect to Redis.
function parseRedisUrl(value: string | undefined): string {
  const redisUrl = value ?? "redis://127.0.0.1:6379";

  try {
    const parsedUrl = new URL(redisUrl);

    if (!["redis:", "rediss:"].includes(parsedUrl.protocol)) {
      throw new Error();
    }

    return redisUrl;
  } catch {
    throw new Error("REDIS_URL must be a valid redis:// or rediss:// URL");
  }
}

// The Docker control plane is deliberately limited to a trusted local operator.
function parseProjectUrl(value: string | undefined): string {
  const url = new URL(value ?? "http://127.0.0.1:3001");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PROJECT_SERVICE_URL must be a loopback HTTP origin.");
  }
  return url.origin;
}

const localPreview = process.env.LOCAL_PREVIEW_ENABLED ?? "false";
if (!["true", "false"].includes(localPreview)) throw new Error("LOCAL_PREVIEW_ENABLED must be true or false.");
if (localPreview === "true" && process.env.NODE_ENV === "production") {
  throw new Error("Local Docker preview is not enabled for public production deployments.");
}

export const env = Object.freeze({
  NODE_ENV: parseEnum<NodeEnvironment>(
    "NODE_ENV",
    process.env.NODE_ENV,
    nodeEnvironments,
    "development",
  ),
  PORT: parsePort(process.env.PORT),
  LOG_LEVEL: parseEnum<LogLevel>("LOG_LEVEL", process.env.LOG_LEVEL, logLevels, "info"),
  REDIS_URL: parseRedisUrl(process.env.REDIS_URL),
  LOCAL_PREVIEW_ENABLED: localPreview === "true",
  PREVIEW_PORT: parsePort(process.env.PREVIEW_PORT, "5101"),
  PROJECT_SERVICE_URL: parseProjectUrl(process.env.PROJECT_SERVICE_URL),
  PREVIEW_RUNNER_IMAGE: process.env.PREVIEW_RUNNER_IMAGE ?? "agentforge-preview-runner:local",
});
