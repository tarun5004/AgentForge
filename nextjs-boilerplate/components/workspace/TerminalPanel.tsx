"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { terminalOutput } from "./workspace-data";

export function TerminalPanel() {
  const [activeTab, setActiveTab] = useState<"terminal" | "problems">("terminal");
  const [isCleared, setIsCleared] = useState(false);

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#121213]">
      <div className="flex h-9 items-center gap-5 border-b border-[#242426] px-4">
        <button
          type="button"
          onClick={() => setActiveTab("terminal")}
          className={`h-full border-b text-[10px] font-medium tracking-wide uppercase ${
            activeTab === "terminal"
              ? "border-[#d0d0d2] text-[#d0d0d2]"
              : "border-transparent text-[#77777c]"
          }`}
        >
          Terminal
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("problems")}
          className={`h-full border-b text-[10px] font-medium tracking-wide uppercase ${
            activeTab === "problems"
              ? "border-[#d0d0d2] text-[#d0d0d2]"
              : "border-transparent text-[#77777c]"
          }`}
        >
          Problems <span className="ml-1 rounded-full bg-[#29292c] px-1.5">0</span>
        </button>
        <button
          type="button"
          onClick={() => setIsCleared(true)}
          aria-label="Clear terminal"
          title="Clear terminal"
          className="ml-auto text-[#6e6e73] hover:text-[#d6d6d8]"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[11px] leading-5 text-[#a8a8ad]">
        {activeTab === "problems" ? (
          <p className="text-[#77777c]">No problems detected in this UI prototype.</p>
        ) : isCleared ? (
          <p className="text-[#66666b]">Terminal cleared.</p>
        ) : (
          terminalOutput.map((line, index) => (
            <div key={`${line}-${index}`}>{line || "\u00a0"}</div>
          ))
        )}
      </div>
    </section>
  );
}
