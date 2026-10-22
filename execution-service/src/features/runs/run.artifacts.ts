import { z } from "zod";

export const MAX_ARTIFACT_BYTES = 6 * 1024 * 1024;
const artifactsSchema = z.array(z.strictObject({ path: z.string().max(240), content: z.string() })).min(1).max(200);
export type Artifacts = Map<string, Buffer>;

// Only bounded regular static files leave the container; no tar extraction or host writes.
export function parseArtifacts(json: string): Artifacts {
  const files = artifactsSchema.parse(JSON.parse(json));
  const artifacts: Artifacts = new Map();
  let bytes = 0;
  for (const file of files) {
    if (!/^[a-zA-Z0-9_./-]+\.(html|js|css|json|txt|ico|png|jpg|jpeg|webp|woff2?)$/.test(file.path) ||
      file.path.startsWith("/") || file.path.split("/").some((part) => part === "." || part === ".." || part === "") ||
      artifacts.has(file.path) || file.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)) {
      throw new Error("Invalid static artifact.");
    }
    const content = Buffer.from(file.content, "base64");
    if (content.toString("base64") !== file.content) throw new Error("Non-canonical artifact encoding.");
    bytes += content.length;
    if (bytes > MAX_ARTIFACT_BYTES) throw new Error("Preview output exceeds 6 MiB.");
    artifacts.set(file.path, content);
  }
  if (!artifacts.has("index.html")) throw new Error("Build produced no homepage.");
  return artifacts;
}
