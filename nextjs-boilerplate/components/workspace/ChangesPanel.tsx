"use client";

import { Check, Circle, FileCode2 } from "lucide-react";

import { agentTasks, type WorkspaceFile } from "./workspace-data";

type ChangesPanelProps = {
  activeFile: WorkspaceFile;
  files: WorkspaceFile[];
  onFileSelect: (path: string) => void;
};

export function ChangesPanel({ activeFile, files, onFileSelect }: ChangesPanelProps) {
  return (
    <aside className="flex h-full min-h-0 flex-col bg-[#161617]">
      <header className="border-b border-[#2b2b2e] px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-[#dedee0]">Changes</h2>
          <span className="rounded-full bg-[#29292c] px-2 py-0.5 text-[10px] text-[#9b9ba0]">
            {files.length}
          </span>
        </div>
        <p className="mt-1 text-[10px] text-[#6f6f74]">Sample workspace files</p>
      </header>

      <div className="border-b border-[#2b2b2e] p-2">
        {files.map((file) => (
          <button
            key={file.path}
            type="button"
            onClick={() => onFileSelect(file.path)}
            className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-[11px] ${
              activeFile.path === file.path
                ? "bg-[#29292c] text-[#ededee]"
                : "text-[#a0a0a5] hover:bg-[#222224]"
            }`}
          >
            <FileCode2 size={13} className="text-[#79b8ff]" />
            <span className="min-w-0 flex-1 truncate">{file.path}</span>
            <span className={file.status === "A" ? "text-[#73c991]" : "text-[#cca700]"}>
              {file.status}
            </span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-[#dedee0]">Agent plan</h2>
          <span className="text-[10px] text-[#6f6f74]">Sample</span>
        </div>

        <div className="mt-4 space-y-3">
          {agentTasks.map((task) => (
            <div key={task.label} className="flex items-center gap-2.5 text-[11px] text-[#a0a0a5]">
              <span className="grid size-4 place-items-center">
                {task.done ? (
                  <Check size={13} className="text-[#73c991]" />
                ) : (
                  <Circle size={11} className="text-[#5d5d62]" />
                )}
              </span>
              {task.label}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
