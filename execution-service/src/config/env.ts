import dotenv from "dotenv";

dotenv.config({ quiet: true });

const nodeEnvironments = ["development", "test", "production"] as const;
const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

type NodeEnvironment = (typeof nodeEnvironments)[number];
type LogLevel = (typeof logLevels)[number];

function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value ?? "5000", 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
}

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

export const env = Object.freeze({
  NODE_ENV: parseEnum<NodeEnvironment>(
    "NODE_ENV",
    process.env.NODE_ENV,
    nodeEnvironments,
    "development",
  ),
  PORT: parsePort(process.env.PORT),
  LOG_LEVEL: parseEnum<LogLevel>("LOG_LEVEL", process.env.LOG_LEVEL, logLevels, "info"),
});
