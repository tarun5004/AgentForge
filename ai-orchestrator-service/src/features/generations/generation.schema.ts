import { z } from "zod";

export const generationRequestSchema = z.strictObject({
  requestId: z.string().trim().min(1).max(100),
  projectId: z.string().regex(/^[a-f\d]{24}$/i, "projectId must be a MongoDB ObjectId."),
  prompt: z.string().trim().min(10).max(1000),
  template: z.literal("nextjs"),
  mode: z.literal("economy"),
});

export const generatedManifestSchema = z.object({
  summary: z
    .string()
    .min(10)
    .max(240)
    .describe("One short sentence explaining what was built."),
  files: z
    .array(
      z.object({
        path: z
          .string()
          .min(1)
          .max(120)
          .describe("Relative Next.js file path using forward slashes."),
        content: z
          .string()
          .min(1)
          .max(30_000)
          .describe("Complete file content without Markdown fences."),
      }),
    )
    .min(1)
    .max(12),
});

export type GenerationRequest = z.infer<typeof generationRequestSchema>;
export type GeneratedManifest = z.infer<typeof generatedManifestSchema>;

const ALLOWED_PATH = /^(app|components|lib)\/[a-zA-Z0-9_./-]+\.(tsx|ts|css)$/;

export function validateManifest(manifest: GeneratedManifest): GeneratedManifest {
  const seenPaths = new Set<string>();
  let totalCharacters = 0;

  for (const file of manifest.files) {
    const path = file.path.trim();
    const lowerPath = path.toLowerCase();

    if (
      !ALLOWED_PATH.test(path) ||
      path.includes("..") ||
      path.includes("\\") ||
      lowerPath.startsWith("app/api/") ||
      lowerPath.endsWith("/route.ts") ||
      lowerPath.endsWith("/route.tsx") ||
      lowerPath.includes(".env") ||
      lowerPath.includes("secret")
    ) {
      throw new Error(`AI returned an unsafe file path: ${path}`);
    }

    if (seenPaths.has(lowerPath)) {
      throw new Error(`AI returned the same file twice: ${path}`);
    }

    if (file.content.includes('"use server"') || file.content.includes("'use server'")) {
      throw new Error(`Server actions are not allowed in generated file: ${path}`);
    }

    seenPaths.add(lowerPath);
    totalCharacters += file.content.length;
  }

  if (totalCharacters > 120_000) {
    throw new Error("AI response is larger than the allowed project size.");
  }

  return manifest;
}
