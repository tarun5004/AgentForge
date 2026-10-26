import type { FileChange, GeneratedFile } from "@/lib/project-api";

export type WorkspaceFile = {
  name: string;
  path: string;
  language: string;
  status: "A" | "M" | null;
  content: string;
};

const languageByExtension: Record<string, string> = {
  css: "CSS",
  js: "JavaScript",
  jsx: "JSX",
  ts: "TypeScript",
  tsx: "TSX",
};

// Preserve unchanged/legacy files without inventing an added/modified badge.
export function createWorkspaceFiles(files: GeneratedFile[], changes: FileChange[] | null = null): WorkspaceFile[] {
  return files.map((file) => {
    const extension = file.path.split(".").pop()?.toLowerCase() ?? "";
    const change = changes?.find((item) => item.path === file.path);

    return {
      name: file.path.split("/").pop() ?? file.path,
      path: file.path,
      language: languageByExtension[extension] ?? "Text",
      status: change?.status === "A" || change?.status === "M" ? change.status : null,
      content: file.content,
    };
  });
}
