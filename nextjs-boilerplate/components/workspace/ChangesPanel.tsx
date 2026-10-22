"use client";

import { FileCode2 } from "lucide-react";
import type { FileChange } from "@/lib/project-api";
import type { WorkspaceFile } from "./workspace-data";

type ChangesPanelProps = {
  activeFile: WorkspaceFile | undefined;
  changes: FileChange[] | null;
  onFileSelect: (path: string) => void;
};

// Deleted paths have no current content, so they are labels rather than selectable file tabs.
export function ChangesPanel({ activeFile, changes, onFileSelect }: ChangesPanelProps) {
  return (
    <aside className="flex h-full min-h-0 flex-col bg-[#161617]">
      <header className="border-b border-[#2b2b2e] px-4 py-3">
        <h2 className="text-xs font-medium text-[#dedee0]">Changes {changes ? `(${changes.length})` : ""}</h2>
        <p className="mt-1 text-[10px] text-[#99999e]">Recorded changes for the selected revision</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {changes === null && <p className="p-2 text-xs text-[#99999e]">Change metadata unavailable.</p>}
        {changes?.length === 0 && <p className="p-2 text-xs text-[#99999e]">No recorded file changes.</p>}
        {changes?.map((change) => {
          const content = <><FileCode2 size={13} className="shrink-0 text-[#79b8ff]" /><span className="min-w-0 flex-1 truncate">{change.path}</span><span className={change.status === "D" ? "text-[#ffaaaa]" : change.status === "A" ? "text-[#73c991]" : "text-[#e8ce87]"}>{change.status}</span></>;
          const style = `flex w-full items-center gap-2 rounded px-2 py-2 text-left text-[11px] ${activeFile?.path === change.path ? "bg-[#29292c] text-[#ededee]" : "text-[#a0a0a5]"}`;
          return change.status === "D"
            ? <div key={change.path} className={style} title="Deleted from this snapshot">{content}</div>
            : <button key={change.path} type="button" onClick={() => onFileSelect(change.path)} className={`${style} hover:bg-[#222224]`}>{content}</button>;
        })}
      </div>
      <p className="border-t border-[#2b2b2e] p-4 text-[11px] text-[#99999e]">Manifest checks alone do not verify builds. Use Preview to build the selected saved revision locally.</p>
    </aside>
  );
}
