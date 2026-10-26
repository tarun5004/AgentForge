import { z } from "zod";

// Leave room below Express's 256 KiB parser ceiling. JSON escaping can multiply content bytes.
export const MAX_CONTEXT_BYTES = 240_000;
export const MANIFEST_POLICY_VERSION = "frontend-manifest-v1";

const fileSchema = z.strictObject({
  path: z.string().min(1).max(120).describe("Canonical relative frontend path using forward slashes."),
  content: z.string().min(1).max(30_000).describe("Complete file contents without Markdown fences."),
});
export const snapshotSchema = z.array(fileSchema).min(1).max(12);
const ALLOWED_PATH = /^(app|components|lib)\/[a-zA-Z0-9_./-]+\.(tsx|ts|css)$/;
const SERVER_DIRECTIVE = /["']use(?:\s|\\x20|\\u0020)+server["']/;

// Reject ambiguous aliases and backend paths rather than normalizing them into another file.
function validatePath(path: string): void {
  const lowerPath = path.toLowerCase();
  if (
    !ALLOWED_PATH.test(path) || path.includes("..") || path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === ".") ||
    lowerPath.startsWith("app/api/") || /\/route\.tsx?$/.test(lowerPath) ||
    lowerPath.includes(".env") || lowerPath.includes("secret")
  ) {
    throw new Error("Unsafe generated frontend file path.");
  }
}

// Validate content and case-insensitive uniqueness at the AI boundary as well as Project Service.
export function validateFiles(files: z.infer<typeof fileSchema>[]): void {
  const seen = new Set<string>();
  let totalCharacters = 0;
  for (const file of files) {
    validatePath(file.path);
    const key = file.path.toLowerCase();
    if (seen.has(key)) throw new Error("AI returned the same file twice.");
    if (SERVER_DIRECTIVE.test(file.content)) throw new Error("Server actions are not allowed in generated files.");
    seen.add(key);
    totalCharacters += file.content.length;
  }
  if (totalCharacters > 120_000) throw new Error("Generated snapshot exceeds the allowed project size.");
}

export const generationRequestSchema = z.strictObject({
  requestId: z.string().trim().min(1).max(100),
  projectId: z.string().regex(/^[a-f\d]{24}$/i, "projectId must be a MongoDB ObjectId."),
  prompt: z.string().trim().min(10).max(1000),
  template: z.literal("nextjs"),
  mode: z.literal("economy"),
  baseRevision: z.strictObject({
    id: z.string().regex(/^[a-f\d]{24}$/i),
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    files: snapshotSchema,
  }).optional(),
}).superRefine((request, context) => {
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > MAX_CONTEXT_BYTES) {
    context.addIssue({
      code: "custom", message: "Serialized generation context is too large.",
      params: { code: "CONTEXT_TOO_LARGE" },
    });
  }
  if (request.baseRevision) {
    try {
      validateFiles(request.baseRevision.files);
    } catch {
      context.addIssue({
        code: "custom", path: ["baseRevision", "files"],
        message: "Base files fail the generated frontend policy.",
      });
    }
  }
});

export const generatedManifestSchema = z.strictObject({
  summary: z.string().min(10).max(240).describe("One short sentence explaining the actual change."),
  files: z.array(fileSchema).max(12).describe("Only added or modified files, each with complete contents. Omitted files are preserved."),
  deletedPaths: z.array(z.string().min(1).max(120)).max(12).default([])
    .describe("Explicit paths to delete from the selected base. Use an empty array for an initial generation."),
});

export type GenerationRequest = z.infer<typeof generationRequestSchema>;
export type GeneratedManifest = z.infer<typeof generatedManifestSchema>;

// Check the change operations against the selected base before returning model output.
// Project Service still independently merges/revalidates before it ever publishes a revision.
export function validateManifest(input: unknown, baseInput: unknown = []): GeneratedManifest {
  const manifest = generatedManifestSchema.parse(input);
  const base = z.array(fileSchema).max(12).parse(baseInput);
  validateFiles(base);
  validateFiles(manifest.files);
  const basePaths = new Map(base.map((file) => [file.path, file]));
  const baseCase = new Map(base.map((file) => [file.path.toLowerCase(), file.path]));
  const upsertKeys = new Set(manifest.files.map((file) => file.path.toLowerCase()));
  const deletedKeys = new Set<string>();
  let changed = false;
  for (const path of manifest.deletedPaths) {
    validatePath(path);
    const key = path.toLowerCase();
    if (deletedKeys.has(key)) throw new Error("Duplicate deletion path.");
    if (upsertKeys.has(key)) throw new Error("A file cannot be updated and deleted together.");
    if (!basePaths.has(path)) throw new Error("Deleted file does not belong to the selected base.");
    deletedKeys.add(key);
    basePaths.delete(path);
    changed = true;
  }
  for (const file of manifest.files) {
    const matchingPath = baseCase.get(file.path.toLowerCase());
    if (matchingPath && matchingPath !== file.path) throw new Error("Case-only file path changes are not allowed.");
    if (basePaths.get(file.path)?.content !== file.content) changed = true;
    basePaths.set(file.path, file);
  }
  if (!basePaths.size) throw new Error("A generated snapshot cannot be empty.");
  if (!changed) throw new Error("No file changes were returned.");
  snapshotSchema.parse([...basePaths.values()]);
  validateFiles([...basePaths.values()]);
  return manifest;
}
