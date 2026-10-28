import { z } from "zod";
import { AppError } from "../middlewares/error.middleware.js";
import { validateRevisionFiles } from "../services/revision-files.js";
import { MAX_CONTEXT_BYTES } from "./generation.contract.js";

export const repairDiagnosticsSchema = z.array(z.strictObject({
  path: z.string().min(1).max(120).nullable(), line: z.number().int().min(1).max(999_999).nullable(),
  column: z.number().int().min(1).max(999_999).nullable(),
  category: z.enum(["typescript", "module", "syntax", "compile"]), code: z.string().regex(/^TS\d{4,5}$/).nullable(),
})).min(1).max(8);
export type RepairDiagnostic = z.infer<typeof repairDiagnosticsSchema>[number];

// Independently check internal feedback, including its relationship to the exact stored candidate.
export function safeRepairDiagnostics(input: unknown, files?: { path: string }[]): RepairDiagnostic[] {
  const parsed = repairDiagnosticsSchema.safeParse(input);
  if (!parsed.success || parsed.data.some((row) => row.path === null
    ? row.line !== null || row.column !== null
    : files !== undefined && !files.some((file) => file.path === row.path))) return [];
  return parsed.data;
}

// Build this context from owned records, not browser source/diagnostics, before reserving paid work.
export function prepareRepairRequest(input: { requestId: string; projectId: string; prompt: string;
  failedFiles: { path: string; content: string }[]; diagnostics: RepairDiagnostic[] }) {
  const request = {
    requestId: z.string().min(1).max(100).parse(input.requestId),
    projectId: z.string().regex(/^[a-f\d]{24}$/i).parse(input.projectId),
    prompt: z.string().trim().min(10).max(1000).parse(input.prompt),
    failedFiles: validateRevisionFiles(input.failedFiles),
    diagnostics: safeRepairDiagnostics(input.diagnostics, input.failedFiles),
  };
  if (!request.diagnostics.length) throw new AppError(409, "Safe build feedback is unavailable.", "REPAIR_UNAVAILABLE");
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > MAX_CONTEXT_BYTES) {
    throw new AppError(413, "Serialized repair context is too large.", "CONTEXT_TOO_LARGE");
  }
  return request;
}
