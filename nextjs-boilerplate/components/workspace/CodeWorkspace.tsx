"use client";

import { useState } from "react";
import { Group, Panel } from "react-resizable-panels";

import { ChangesPanel } from "./ChangesPanel";
import { EditorPanel } from "./EditorPanel";
import { ResizeHandle } from "./ResizeHandle";
import { TerminalPanel } from "./TerminalPanel";
import { workspaceFiles } from "./workspace-data";

type CodeWorkspaceProps = {
  isResizable: boolean;
};

export function CodeWorkspace({ isResizable }: CodeWorkspaceProps) {
  const [activeFilePath, setActiveFilePath] = useState(workspaceFiles[0].path);

  // Editor tabs and Changes panel use one shared selected file.
  const activeFile =
    workspaceFiles.find((file) => file.path === activeFilePath) ?? workspaceFiles[0];

  const editor = (
    <EditorPanel
      activeFile={activeFile}
      files={workspaceFiles}
      onFileSelect={setActiveFilePath}
    />
  );
  const terminal = <TerminalPanel />;
  const changes = (
    <ChangesPanel
      activeFile={activeFile}
      files={workspaceFiles}
      onFileSelect={setActiveFilePath}
    />
  );

  // On smaller screens a normal vertical layout is easier to use than drag handles.
  if (!isResizable) {
    return (
      <div className="grid min-w-0 grid-cols-1">
        <div className="min-h-[460px]">{editor}</div>
        <div className="min-h-[220px] border-t border-[#2b2b2e]">{terminal}</div>
        <div className="min-h-[520px] border-t border-[#2b2b2e]">{changes}</div>
      </div>
    );
  }

  return (
    <Group id="code-and-changes" orientation="horizontal" className="h-full min-w-0">
      <Panel id="code-area" defaultSize="76%" minSize={500}>
        <Group id="editor-and-terminal" orientation="vertical" className="h-full">
          <Panel id="editor" defaultSize="70%" minSize={260}>
            {editor}
          </Panel>

          <ResizeHandle direction="vertical" />

          <Panel id="terminal" defaultSize={220} minSize={140} maxSize="55%">
            {terminal}
          </Panel>
        </Group>
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
