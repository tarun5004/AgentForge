"use client";

import { Bot, GitBranch, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Group, Panel } from "react-resizable-panels";

import { useAuth } from "@/components/auth/AuthProvider";
import type { WorkspaceSelection } from "@/lib/workspace-selection";

import { ChatPanel } from "./ChatPanel";
import { CodeWorkspace } from "./CodeWorkspace";
import { ResizeHandle } from "./ResizeHandle";
import {
  createWorkspaceFiles,
} from "./workspace-data";
import { useWorkspace } from "./useWorkspace";
import { PreviewLauncher } from "./PreviewLauncher";

// Keep request/selection state above both layouts, not inside panels that remount on resize.
export function WorkspaceShell({ selection }: { selection: WorkspaceSelection }) {
  const router = useRouter();
  const { user, projectSession, logout, invalidateSession } = useAuth();
  const workspace = useWorkspace(selection, user ? projectSession : null, user?.id ?? null, invalidateSession);
  const [isDesktop, setIsDesktop] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [previewTarget, setPreviewTarget] = useState<string | null>(null);
  const previewKey = `${workspace.project?.id}:${workspace.revision?.id}`;
  const generatedFiles = createWorkspaceFiles(workspace.revision?.files ?? [], workspace.revision?.fileChanges ?? null);
  const editorMessage = workspace.loadError || (workspace.loadBusy ? "Loading saved files..." : "No generated files. Submit a prompt or choose a saved revision.");

  // Chat and toolbar open the same selected revision; navigation cannot reuse a different target.
  function openPreview() {
    if (workspace.project && workspace.revision && !workspace.busy && !workspace.loadBusy) setPreviewTarget(previewKey);
  }

  // Signing out is disabled during generation so its request identity cannot be lost mid-submit.
  async function handleSignOut() {
    setIsSigningOut(true);
    setSignOutError("");

    try {
      await logout();
      router.replace("/login");
    } catch {
      setSignOutError("Could not sign out. Please try again.");
      setIsSigningOut(false);
    }
  }

  useEffect(() => {
    const desktopScreen = window.matchMedia("(min-width: 1280px)");

    // Reflow the layout only; workspace state remains in the shell-owned hook.
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
          <span className="hidden text-xs text-[#99999e] sm:inline">{workspace.project?.name ?? "New project"}</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[10px] text-[#929298] lg:inline">
            {user?.name}
          </span>
          <span className="hidden items-center gap-1.5 text-[10px] text-[#77777c] md:flex">
            <GitBranch size={12} /> {workspace.revision ? `v${workspace.revision.version}` : "Draft"}
          </span>
          <span className="rounded border border-[#353539] bg-[#222224] px-2 py-1 text-[10px] text-[#929298]">
            Saved history
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut || workspace.busy}
            title="Sign out"
            aria-label="Sign out"
            className="grid size-7 place-items-center rounded-md border border-[#353539] text-[#929298] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LogOut size={13} />
          </button>
          <PreviewLauncher key={`${user?.id}:${workspace.project?.id}:${workspace.revision?.id}`}
            projectId={workspace.project?.id ?? null} revisionId={workspace.revision?.id ?? null}
            disabled={workspace.busy || workspace.loadBusy || isSigningOut}
            open={previewTarget === previewKey} onOpen={openPreview} onClose={() => setPreviewTarget(null)} onActivity={workspace.recordPreview} />
        </div>
      </header>

      {signOutError && (
        <p
          role="alert"
          className="fixed top-14 right-3 z-50 rounded-md border border-[#5a3030] bg-[#241616] px-3 py-2 text-xs text-[#ffaaaa] shadow-lg"
        >
          {signOutError}
        </p>
      )}

      {isDesktop ? (
        <div className="h-[calc(100dvh-44px)]">
          <Group id="chat-and-workspace" orientation="horizontal" className="h-full">
            <Panel
              id="chat"
              defaultSize={400}
              minSize={320}
              maxSize="45%"
              groupResizeBehavior="preserve-pixel-size"
            >
              <ChatPanel workspace={workspace} onPreview={openPreview} />
            </Panel>

            <ResizeHandle direction="horizontal" />

            <Panel id="workspace" minSize={720}>
              <CodeWorkspace key={workspace.revision?.id ?? "empty"} isResizable files={generatedFiles} changes={workspace.revision?.fileChanges ?? null} message={editorMessage} />
            </Panel>
          </Group>
        </div>
      ) : (
        // Small screens keep the original stacked layout without drag handles.
        <div className="grid min-h-[calc(100dvh-44px)] grid-cols-1">
          <ChatPanel workspace={workspace} onPreview={openPreview} />
          <CodeWorkspace key={workspace.revision?.id ?? "empty"} isResizable={false} files={generatedFiles} changes={workspace.revision?.fileChanges ?? null} message={editorMessage} />
        </div>
      )}
    </main>
  );
}
