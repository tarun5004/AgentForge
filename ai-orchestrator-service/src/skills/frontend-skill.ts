import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const FRONTEND_SKILL_ID = "frontend-design";
export const FRONTEND_SKILL_HASH = "dc626b4d8f8e805ddc392b9cf68a595471ee7e788a6ef48f4871842f8125c2ee";

// Pin reviewed text, not a mutable GitHub URL; tolerate Git's Windows line-ending conversion only.
export function validateFrontendSkill(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const hash = createHash("sha256").update(normalized).digest("hex");
  if (Buffer.byteLength(normalized, "utf8") > 4096 || hash !== FRONTEND_SKILL_HASH) {
    throw new Error("Frontend skill does not match the reviewed local version.");
  }
  return normalized;
}

// The path is fixed server-side: neither the model nor a browser can read arbitrary files or URLs.
export async function loadFrontendSkill() {
  const text = await readFile(new URL("../../skills/frontend-design/SKILL.md", import.meta.url), "utf8");
  return {
    id: FRONTEND_SKILL_ID,
    version: "agentforge-frontend-design-v1",
    sourceRevision: "dbd4588f9e1033efb41dad4bef2f7947c8993d44",
    contentSha256: FRONTEND_SKILL_HASH,
    instructions: validateFrontendSkill(text),
  };
}
