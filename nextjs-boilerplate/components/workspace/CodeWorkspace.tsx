"use client";

import { useState } from "react";
import { EditorPanel } from "./EditorPanel";
import type { WorkspaceFile } from "./workspace-data";

// Only persisted files belong in the editor; changes/history live in the chat drawer.
export function CodeWorkspace({ files, message }: { files: WorkspaceFile[]; message: string }) {
  const [activePath, setActivePath] = useState(files[0]?.path ?? "");
  const activeFile = files.find((file) => file.path === activePath) ?? files[0];
  return activeFile ? <EditorPanel activeFile={activeFile} files={files} onFileSelect={setActivePath} />
    : <section role="status" className="grid h-full min-h-[300px] place-items-center bg-[#101011] p-6 text-center text-sm text-[#99999e]">{message}</section>;
}
