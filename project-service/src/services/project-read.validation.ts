import { AppError } from "../middlewares/error.middleware.js";

export type ProjectCursor = { createdAt: Date; id: string };

export function assertReadResponseSize(response: unknown): void {
  // Legacy records may bypass today's schema limits; reject rather than silently truncate.
  if (Buffer.byteLength(JSON.stringify(response), "utf8") > 1_048_576) {
    throw new AppError(413, "Saved data exceeds the 1 MiB read response limit.");
  }
}

export function validateObjectId(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value)) {
    throw new AppError(400, `${field} must be a valid MongoDB ID.`);
  }
  return value.toLowerCase();
}

export function validateQueryKeys(query: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(query).some((key) => !allowed.includes(key))) {
    throw new AppError(400, "Unsupported query parameter.");
  }
}

function readLimit(value: unknown): number {
  if (value === undefined) return 20;
  if (typeof value !== "string" || !/^[1-9]\d?$/.test(value) || Number(value) > 50) {
    throw new AppError(400, "limit must be an integer between 1 and 50.");
  }
  return Number(value);
}

export function encodeProjectCursor(position: ProjectCursor): string {
  return Buffer.from(JSON.stringify({ createdAt: position.createdAt.toISOString(), id: position.id })).toString("base64url");
}

function readProjectCursor(value: unknown): ProjectCursor | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AppError(400, "Invalid project cursor.");
  }
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error();
    const fields = decoded as Record<string, unknown>;
    if (Object.keys(fields).length !== 2 || typeof fields.createdAt !== "string") throw new Error();
    validateQueryKeys(fields, ["createdAt", "id"]);
    const createdAt = new Date(fields.createdAt);
    const id = validateObjectId(fields.id, "cursor ID");
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== fields.createdAt) throw new Error();
    const cursor = { createdAt, id };
    // Accept only our canonical encoding; loose base64 decoding can hide malformed input.
    if (encodeProjectCursor(cursor) !== value) throw new Error();
    return cursor;
  } catch {
    throw new AppError(400, "Invalid project cursor.");
  }
}

export function validateProjectQuery(query: Record<string, unknown>) {
  validateQueryKeys(query, ["limit", "cursor"]);
  return { limit: readLimit(query.limit), cursor: readProjectCursor(query.cursor) };
}
