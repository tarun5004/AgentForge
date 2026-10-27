"use client";

import { ArrowLeft, ArrowUp, History, MessageSquarePlus, RefreshCw } from "lucide-react";
import type { FormEvent, KeyboardEvent, MouseEvent } from "react";
import type { WorkspaceState } from "./useWorkspace";
import { ConversationTimeline } from "./ConversationTimeline";

// Render shell-owned state: changing screen size must not reset a conversation or request.
export function ChatPanel({ workspace, onPreview }: { workspace: WorkspaceState; onPreview: () => void }) {
  const { project, revision, busy, pending } = workspace;
  const errorInTranscript = workspace.conversation?.entries.some((entry) => entry.kind === "activity" &&
    ["error", "unknown"].includes(entry.state ?? "") && workspace.submitError.startsWith(entry.text));

  // Both the button and keyboard use one validated operation and one idempotency key.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void workspace.submit();
  }

  // Preserve multiline text and IME composition; only a normal Enter submits.
  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    if (event.repeat || !workspace.canSubmit || !workspace.prompt.trim()) return;
    event.currentTarget.form?.requestSubmit();
  }

  // Recent conversations are a header dropdown, not a permanent block inside the chat.
  function openSavedProject(event: MouseEvent<HTMLButtonElement>, projectId: string) {
    event.currentTarget.closest("details")?.removeAttribute("open");
    workspace.navigate(projectId);
  }

  return <aside aria-label="Agent chat" className="relative flex h-[85dvh] min-h-[620px] flex-col bg-[#303030] text-[#e1e1e1] xl:h-full xl:min-h-0">
    <header className="flex shrink-0 items-center gap-3 px-3 py-2 text-[13px]">
      <span className="text-[#b0b0b0]">Chat</span><h2 className="rounded bg-[#414141] px-2 py-0.5 font-medium">AgentForge</h2>
      <details className="ml-auto text-xs">
        <summary aria-label="Saved conversations" title="Saved conversations" className="cursor-pointer list-none rounded p-1 text-[#b0b0b0] hover:bg-[#414141]"><History size={16} /></summary>
        <div className="absolute top-10 right-3 left-3 z-20 max-h-64 overflow-y-auto rounded-lg border border-[#505050] bg-[#292929] p-3 shadow-xl">
          <p className="font-medium">Recent conversations</p>
          <button type="button" onClick={() => void workspace.refreshChats()} disabled={busy} className="mt-2 underline disabled:opacity-40">Reload conversations</button>
          {workspace.chatListError && <p role="alert" className="mt-2 text-[#ffaaaa]">{workspace.chatListError}</p>}
          {!workspace.chatListError && workspace.savedChats.length === 0 && <p className="mt-2 text-[#99999e]">No saved chats yet.</p>}
          <div className="mt-2 space-y-1">{workspace.savedChats.map((saved) => <button key={saved.id} type="button" disabled={busy}
            onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); workspace.navigate(saved.projectId, null, saved.id); }}
            className="block w-full truncate rounded px-2 py-2 text-left hover:bg-[#383838] disabled:opacity-40">{saved.title}</button>)}</div>
          {workspace.chatCursor && <button type="button" disabled={busy} onClick={() => void workspace.loadMoreChats()} className="mt-2 underline disabled:opacity-40">Load more conversations</button>}
          <p className="mt-4 font-medium">Saved projects</p>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-[#77777c]">Choose a conversation</span>
            <button type="button" onClick={() => void workspace.refreshProjects()} disabled={workspace.listBusy || busy} aria-label="Reload saved projects" className="p-1 text-[#99999e] disabled:opacity-40"><RefreshCw size={13} /></button>
          </div>
          {workspace.listError && <p role="alert" className="text-[#ffaaaa]">{workspace.listError}</p>}
          {workspace.listBusy && <p role="status" className="text-[#99999e]">Loading projects...</p>}
          {!workspace.listBusy && !workspace.listError && workspace.projects.length === 0 && <p className="py-1 text-[#99999e]">No saved projects yet.</p>}
          <div className="space-y-1">{workspace.projects.map((saved) => <button key={saved.id} type="button" onClick={(event) => openSavedProject(event, saved.id)} disabled={busy}
            aria-pressed={saved.id === workspace.selectedProjectId} className={`flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left disabled:opacity-40 ${saved.id === workspace.selectedProjectId ? "bg-[#414141] text-white" : "text-[#b5b5b5] hover:bg-[#383838]"}`}>
            <span className="truncate">{saved.name}</span><span className="shrink-0 text-[10px] text-[#99999e]">{saved.latestRevision ? `v${saved.latestRevision.version}` : "Draft"}</span>
          </button>)}</div>
          {workspace.projectCursor && <button type="button" disabled={busy || workspace.listBusy} onClick={() => void workspace.loadMoreProjects()} className="mt-2 underline disabled:opacity-40">Load more projects</button>}
          <p className="mt-3 text-[10px] text-[#99999e]">New chats are saved to your account. Older browser-only chats are not uploaded.</p>
        </div>
      </details>
      <button type="button" onClick={() => workspace.navigate(null)} disabled={busy} aria-label="New conversation" title="New conversation" className="rounded p-1 text-[#b0b0b0] hover:bg-[#414141] disabled:opacity-40"><MessageSquarePlus size={16} /></button>
    </header>
    <div className="flex shrink-0 items-center gap-2 px-3 pb-3 text-xs">
      <button type="button" disabled={busy} onClick={() => workspace.navigate(null)} className="flex items-center gap-1 text-[#dedede] disabled:opacity-40"><ArrowLeft size={12} /> Start a conversation</button>
      {revision && <span className="ml-auto text-[10px] text-[#a5a5a5]">Viewing v{revision.version}</span>}
    </div>

    <ConversationTimeline workspace={workspace} onPreview={onPreview} />
    <div className="flex shrink-0 gap-3 px-3 py-1 text-xs text-[#bdbdbd]">
      <button type="button" disabled={busy || workspace.loadBusy} onClick={workspace.refreshSelection} className="underline disabled:opacity-40">Reload saved chat</button>
      {workspace.olderChatCursor !== null && <button type="button" disabled={busy || workspace.loadBusy} onClick={() => void workspace.loadOlderChat()} className="underline disabled:opacity-40">Load older messages</button>}
      {workspace.replyStreaming && <button type="button" onClick={workspace.stopReply} className="ml-auto underline">Stop reply</button>}
    </div>

    {revision && <details className="mx-3 max-h-[25%] shrink-0 overflow-y-auto rounded-t-xl border border-b-0 border-[#494949] px-3 py-2 text-xs">
      <summary aria-label="Revision history" className="flex cursor-pointer list-none items-center justify-between text-[#bdbdbd]"><span>{revision?.fileChanges?.length ?? 0} files changed</span><span>View changes</span></summary>
      <ul className="my-2 space-y-1">{revision.fileChanges?.map((file) => <li key={file.path} className="break-all text-[#bdbdbd]">{file.status} {file.path}</li>)}</ul>
      <button type="button" disabled={busy || workspace.loadBusy} onClick={workspace.clearLocalChat} className="mt-2 text-[10px] text-[#99999e] underline disabled:opacity-40">Clear local chat messages</button>
      <section aria-label="Revision history" className="mt-2 space-y-2">
        {workspace.revisions.length === 0 && !workspace.loadBusy && <p className="text-[#99999e]">No saved revisions.</p>}
        {workspace.revisions.map((item) => <button type="button" key={item.id} onClick={() => workspace.navigate(project!.id, item.id)} disabled={busy || workspace.loadBusy}
          aria-pressed={revision?.id === item.id} className={`w-full rounded border p-2 text-left disabled:opacity-40 ${revision?.id === item.id ? "border-[#58734c] bg-[#20281d]" : "border-[#303034] hover:bg-[#222224]"}`}>
          <span className="text-[#b6f09c]">v{item.version}</span><p className="mt-1 text-[#d6d6d8]">{item.sourcePrompt ?? "Producing prompt unknown (legacy)"}</p>
          <p className="mt-1 text-[10px] text-[#99999e]">{item.summary}</p>
        </button>)}
        {workspace.revisionCursor && <button type="button" disabled={busy || workspace.loadBusy} onClick={() => void workspace.loadMoreRevisions()} className="text-[#b6f09c] disabled:opacity-40">Load older revisions</button>}
      </section>
    </details>}

    <form onSubmit={handleSubmit} className="shrink-0 px-3 pb-3 pt-1">
      {workspace.submitError && !errorInTranscript && <p role="alert" className="mb-2 text-xs text-[#ffaaaa]">{workspace.submitError}</p>}
      <p role="status" className="mb-2 text-[10px] text-[#99999e]">{busy || pending ? workspace.notice : revision ? `Chat, plan, or request an edit to v${revision.version}.` : workspace.notice}</p>
      {project?.latestRevision && revision && revision.id !== project.latestRevision.id && <p className="mb-2 text-[10px] text-[#e8ce87]">Historical base selected: v{revision.version}. Latest is v{project.latestRevision.version}.</p>}
      {pending && !busy && <div className="mb-3 space-y-2 rounded border border-[#655738] p-2 text-[11px] text-[#e8ce87]">
        <p>Unconfirmed attempt retained: {pending.body.prompt ?? "Initial generation"}</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => void workspace.submit(true)} className="underline">Retry same attempt</button>
          {pending.generationId && <button type="button" onClick={() => void workspace.checkPending()} className="underline">Check status</button>}
          <button type="button" onClick={workspace.abandonPending} className="underline">Abandon attempt</button>
        </div>
      </div>}
      <div className="rounded-2xl border border-[#505050] bg-[#333333] px-3 pb-2 pt-3 focus-within:border-[#888888]">
        <label htmlFor="workspace-prompt" className="sr-only">Message AgentForge</label>
        <textarea id="workspace-prompt" value={workspace.prompt} onChange={(event) => workspace.setPrompt(event.target.value)} onKeyDown={handlePromptKeyDown} aria-describedby="workspace-prompt-help"
          placeholder="Ask a question or describe what to build…" rows={3} maxLength={1000} minLength={1} disabled={busy}
          className="w-full resize-none bg-transparent px-1 text-[13px] outline-none placeholder:text-[#99999e] disabled:opacity-50" />
        <p id="workspace-prompt-help" className="px-1 text-[10px] text-[#99999e]">Enter to send · Shift+Enter for a new line</p>
        <div className="mt-2 flex items-center justify-between">
          <span className="px-1 text-[10px] text-[#b0b0b0]">{busy ? "Working…" : "Local workspace"} · {workspace.prompt.length}/1000</span>
          <button type="submit" disabled={!workspace.canSubmit || !workspace.prompt.trim()} aria-label="Send message" className="grid size-7 place-items-center rounded-md bg-[#dddddf] text-[#111112] disabled:opacity-30">{busy ? "..." : <ArrowUp size={15} />}</button>
        </div>
      </div>
    </form>
  </aside>;
}
