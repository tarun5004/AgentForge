"use client";

import { Bot, GitBranch, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { Group, Panel } from "react-resizable-panels";

import { ChatPanel } from "./ChatPanel";
import { CodeWorkspace } from "./CodeWorkspace";
import { ResizeHandle } from "./ResizeHandle";

export function WorkspaceShell() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const desktopScreen = window.matchMedia("(min-width: 1280px)");

    function updateLayout() {
      setIsDesktop(desktopScreen.matches);
    }

    // The resize library is enabled only when the IDE has enough screen space.
    updateLayout();
    desktopScreen.addEventListener("change", updateLayout);

    return () => desktopScreen.removeEventListener("change", updateLayout);
  }, []);

  return (
    <main className="min-h-dvh bg-[#0f0f10] text-[#d6d6d8]">
      {/* This top bar contains project-level controls shared by every panel. */}
      <header className="flex h-11 items-center border-b border-[#2b2b2e] bg-[#181819] px-3">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md bg-[#dddddf] text-[#111112]">
            <Bot size={15} />
          </span>
          <span className="text-xs font-semibold text-[#ededee]">AgentForge</span>
          <span className="hidden text-[#55555a] sm:inline">/</span>
          <span className="hidden text-xs text-[#99999e] sm:inline">portfolio-app</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-[10px] text-[#77777c] md:flex">
            <GitBranch size={12} /> main
          </span>
          <span className="rounded border border-[#353539] bg-[#222224] px-2 py-1 text-[10px] text-[#929298]">
            Local UI
          </span>
          <button
            type="button"
            disabled
            title="Backend preview will be connected later"
            className="flex items-center gap-1.5 rounded-md bg-[#dddddf] px-3 py-1.5 text-[10px] font-medium text-[#111112] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play size={11} fill="currentColor" /> Preview
          </button>
        </div>
      </header>

      {isDesktop ? (
        <div className="h-[calc(100dvh-44px)]">
          <Group id="chat-and-workspace" orientation="horizontal" className="h-full">
            <Panel
              id="chat"
              defaultSize={310}
              minSize={240}
              maxSize="40%"
              groupResizeBehavior="preserve-pixel-size"
            >
              <ChatPanel />
            </Panel>

            <ResizeHandle direction="horizontal" />

            <Panel id="workspace" minSize={720}>
              <CodeWorkspace isResizable />
            </Panel>
          </Group>
        </div>
      ) : (
        // Small screens keep the original stacked layout without drag handles.
        <div className="grid min-h-[calc(100dvh-44px)] grid-cols-1">
          <ChatPanel />
          <CodeWorkspace isResizable={false} />
        </div>
      )}
    </main>
  );
}
