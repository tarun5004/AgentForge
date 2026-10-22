import { z } from "zod";

const mongoObjectIdSchema = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "Must be a valid MongoDB ObjectId")
  .toLowerCase();

export const createRunBodySchema = z.strictObject({
  projectId: mongoObjectIdSchema,
  revisionId: mongoObjectIdSchema,
});

export type CreateRunBody = z.infer<typeof createRunBodySchema>;

export const runIdSchema = z.string().uuid();
export const revisionSchema = z.object({
  id: mongoObjectIdSchema,
  projectId: mongoObjectIdSchema,
  files: z.array(z.strictObject({
    path: z.string().min(1).max(120),
    content: z.string().min(1).max(30_000),
  })).min(1).max(12),
});
export type Revision = z.infer<typeof revisionSchema>;

// Stored files are still untrusted; only frontend source may enter the fixed template.
export function validateRevision(input: unknown): Revision {
  const revision = revisionSchema.parse(input);
  const paths = new Set<string>();
  let characters = 0;
  for (const file of revision.files) {
    const lower = file.path.toLowerCase();
    if (!/^(app|components|lib)\/[a-zA-Z0-9_/-]+(?:\.[a-zA-Z0-9_-]+)*\.(tsx|ts|css)$/.test(file.path) ||
      lower.includes("..") || file.path.split("/").some((part) => !part || part === ".") ||
      lower.startsWith("app/api/") || /\/route\.tsx?$/.test(lower) ||
      lower.includes("secret") || paths.has(lower) || /["']use(?:\s|\\x20|\\u0020)+server["']/.test(file.content)) {
      throw new Error("Revision contains unsupported frontend files.");
    }
    paths.add(lower);
    characters += file.content.length;
  }
  if (characters > 120_000 || !revision.files.some((file) => file.path === "app/page.tsx")) {
    throw new Error("Preview needs a bounded snapshot with app/page.tsx.");
  }
  return revision;
}
