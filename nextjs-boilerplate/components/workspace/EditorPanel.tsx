"use client";

import { Code2 } from "lucide-react";

import type { WorkspaceFile } from "./workspace-data";

type EditorPanelProps = {
  activeFile: WorkspaceFile;
  files: WorkspaceFile[];
  onFileSelect: (path: string) => void;
};

export function EditorPanel({ activeFile, files, onFileSelect }: EditorPanelProps) {
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-[#101011]">
      <div className="flex h-9 items-center overflow-x-auto border-b border-[#2b2b2e] bg-[#19191a]">
        {files.map((file) => {
          const isActive = file.path === activeFile.path;

          return (
            <button
              key={file.path}
              type="button"
              onClick={() => onFileSelect(file.path)}
              className={`flex h-full shrink-0 items-center gap-2 border-r border-[#2b2b2e] px-3 text-[11px] ${
                isActive
                  ? "border-t border-t-[#a5a5aa] bg-[#101011] text-[#ededee]"
                  : "text-[#89898e] hover:bg-[#202022]"
              }`}
            >
              <Code2 size={12} className="text-[#79b8ff]" />
              {file.name}
              <span className={file.status === "A" ? "text-[#73c991]" : "text-[#cca700]"}>
                {file.status}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex h-8 items-center border-b border-[#242426] px-4 text-[10px] text-[#77777c]">
        <span>agentforge</span>
        <span className="mx-1.5">›</span>
        <span>{activeFile.path}</span>
        <span className="ml-auto">{activeFile.language}</span>
      </div>

      {/* A plain code viewer is enough until real file editing is introduced. */}
      <div className="min-h-0 flex-1 overflow-auto py-3 font-mono text-xs leading-5">
        {activeFile.content.split("\n").map((line, index) => (
          <div
            key={`${activeFile.path}-${index}`}
            className="flex min-w-max px-3 hover:bg-[#18181a]"
          >
            <span className="mr-5 w-7 shrink-0 select-none text-right text-[#505055]">
              {index + 1}
            </span>
            <span className="whitespace-pre text-[#cccccf]">{line || " "}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
