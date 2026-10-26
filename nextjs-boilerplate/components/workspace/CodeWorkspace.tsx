"use client";

import { useState } from "react";
import { Group, Panel } from "react-resizable-panels";

import { ChangesPanel } from "./ChangesPanel";
import { EditorPanel } from "./EditorPanel";
import { ResizeHandle } from "./ResizeHandle";
import type { WorkspaceFile } from "./workspace-data";
import type { FileChange } from "@/lib/project-api";

type CodeWorkspaceProps = {
  isResizable: boolean;
  files: WorkspaceFile[];
  changes: FileChange[] | null;
  message: string;
};

// A draft/loading/error view must never display demo files as persisted output.
export function CodeWorkspace({ isResizable, files: visibleFiles, changes: fileChanges, message }: CodeWorkspaceProps) {
  const [activeFilePath, setActiveFilePath] = useState(visibleFiles[0]?.path ?? "");

  // Editor tabs and Changes panel use one shared selected file.
  const activeFile =
    visibleFiles.find((file) => file.path === activeFilePath) ?? visibleFiles[0];

  const editor = (
    activeFile ? <EditorPanel
      activeFile={activeFile}
      files={visibleFiles}
      onFileSelect={setActiveFilePath}
    /> : <section role="status" className="grid h-full min-h-[300px] place-items-center bg-[#101011] p-6 text-center text-sm text-[#99999e]">{message}</section>
  );
  const changes = (
    <ChangesPanel
      activeFile={activeFile}
      changes={fileChanges}
      onFileSelect={setActiveFilePath}
    />
  );

  // On smaller screens a normal vertical layout is easier to use than drag handles.
  if (!isResizable) {
    return (
      <div className="grid min-w-0 grid-cols-1">
        <div className="min-h-[460px]">{editor}</div>
        <div className="min-h-[520px] border-t border-[#2b2b2e]">{changes}</div>
      </div>
    );
  }

  return (
    <Group id="code-and-changes" orientation="horizontal" className="h-full min-w-0">
      <Panel id="code-area" defaultSize="76%" minSize={500}>
        {editor}
      </Panel>

      <ResizeHandle direction="horizontal" />

      <Panel
        id="changes"
        defaultSize={280}
        minSize={220}
        maxSize={420}
        groupResizeBehavior="preserve-pixel-size"
      >
        {changes}
      </Panel>
    </Group>
  );
}
