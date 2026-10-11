import { z } from "zod";

import { AppError } from "../middlewares/error.middleware.js";

const fileSchema = z.strictObject({
  path: z.string().min(1).max(120),
  content: z.string().min(1).max(30_000),
});
const changeSetSchema = z.strictObject({
  files: z.array(fileSchema).max(12),
  deletedPaths: z.array(z.string().min(1).max(120)).max(12).default([]),
});

export type RevisionFile = z.infer<typeof fileSchema>;
// A = added, M = modified, D = deleted. Unchanged files get no change entry.
export type FileChange = { path: string; status: "A" | "M" | "D" };

const ALLOWED_PATH = /^(app|components|lib)\/[a-zA-Z0-9_./-]+\.(tsx|ts|css)$/;
const SERVER_DIRECTIVE = /["']use(?:\s|\\x20|\\u0020)+server["']/;

// Accept only canonical frontend paths. Reject aliases rather than guessing which file they mean.
// This policy intentionally matches the AI service's independent network-boundary validation.
export function validateGeneratedPath(path: string): void {
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

// Recheck stored and returned files: historical data and AI output are not trusted implicitly.
// The empty base is allowed only for an initial generation, not for a saved revision.
export function validateRevisionFiles(input: unknown, allowEmpty = false): RevisionFile[] {
  const files = z.array(fileSchema).min(allowEmpty ? 0 : 1).max(12).parse(input);
  const seenPaths = new Set<string>();
  let totalCharacters = 0;
  for (const file of files) {
    validateGeneratedPath(file.path);
    const key = file.path.toLowerCase();
    if (seenPaths.has(key)) throw new Error("Generated output contains the same file twice.");
    if (SERVER_DIRECTIVE.test(file.content)) throw new Error("Server actions are not allowed in generated files.");
    seenPaths.add(key);
    totalCharacters += file.content.length;
  }
  if (totalCharacters > 120_000) {
    throw new AppError(413, "Generated snapshot exceeds the allowed project size.", "SNAPSHOT_TOO_LARGE");
  }
  return files;
}

// Use an explicit path order so snapshots/diffs do not depend on model response order or locale.
function comparePaths(first: { path: string }, second: { path: string }): number {
  if (first.path < second.path) return -1;
  if (first.path > second.path) return 1;
  return 0;
}

// Apply complete changed-file contents to a copy of the base; omitted files stay untouched.
// Explicit deletion protects against losing files merely because the model did not repeat them.
export function mergeRevisionFiles(baseInput: unknown, changeInput: unknown) {
  const base = validateRevisionFiles(baseInput, true);
  const changes = changeSetSchema.parse(changeInput);
  const upserts = validateRevisionFiles(changes.files, true); // Upsert means add OR replace a file.
  const byPath = new Map(base.map((file) => [file.path, file]));
  const existingCase = new Map(base.map((file) => [file.path.toLowerCase(), file.path]));
  const upsertKeys = new Set(upserts.map((file) => file.path.toLowerCase()));
  const deletedKeys = new Set<string>();
  const fileChanges: FileChange[] = [];

  for (const path of changes.deletedPaths) {
    validateGeneratedPath(path);
    const key = path.toLowerCase();
    if (deletedKeys.has(key)) throw new Error("Duplicate deletion path.");
    if (upsertKeys.has(key)) throw new Error("A file cannot be updated and deleted together.");
    if (!byPath.has(path)) throw new Error("Deleted file does not belong to the selected base.");
    deletedKeys.add(key);
    byPath.delete(path);
    fileChanges.push({ path, status: "D" });
  }
  for (const file of upserts) {
    const matchingPath = existingCase.get(file.path.toLowerCase());
    if (matchingPath && matchingPath !== file.path) throw new Error("Case-only file path changes are not allowed.");
    const previous = byPath.get(file.path);
    if (!previous || previous.content !== file.content) {
      fileChanges.push({ path: file.path, status: previous ? "M" : "A" });
    }
    byPath.set(file.path, file);
  }

  if (byPath.size === 0) throw new Error("A generated snapshot cannot be empty.");
  if (fileChanges.length === 0) throw new Error("No file changes were returned.");
  // Check the FINAL snapshot too: individually valid upserts can overflow an existing project.
  const files = validateRevisionFiles([...byPath.values()]);
  files.sort(comparePaths);
  fileChanges.sort(comparePaths);
  return { files, fileChanges };
}
