"use client";

import { ArrowUp, MessageSquarePlus, RefreshCw, Sparkles } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import type { WorkspaceState } from "./useWorkspace";

// This panel renders shell-owned state so resizing never discards a draft or running request.
export function ChatPanel({ workspace }: { workspace: WorkspaceState }) {
  const { project, revision, busy, pending } = workspace;
  const parentVersion = workspace.revisions.find((item) => item.id === revision?.parentRevisionId)?.version;

  // Submit through the single shell-owned operation; the panel never calls a service itself.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void workspace.submit();
  }

  // Enter sends through the same validated form; Shift+Enter and IME input stay multiline.
  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    if (event.repeat || !workspace.canSubmit || workspace.prompt.trim().length < 10) return;
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <aside className="flex h-full min-h-[720px] flex-col border-b border-[#2b2b2e] bg-[#151516] xl:min-h-0 xl:border-b-0">
      <section className="max-h-[35%] overflow-y-auto border-b border-[#2b2b2e] p-3">
        <button type="button" onClick={() => workspace.navigate(null)} disabled={busy} className="flex w-full items-center gap-2 rounded-md border border-[#38383c] bg-[#202022] px-3 py-2 text-xs hover:bg-[#29292c] disabled:opacity-40">
          <MessageSquarePlus size={14} /> New conversation
        </button>
        <div className="mt-4 flex items-center justify-between">
          <h2 className="text-[10px] font-semibold tracking-widest text-[#99999e] uppercase">Saved projects</h2>
          <button type="button" onClick={() => void workspace.refreshProjects()} disabled={workspace.listBusy || busy} aria-label="Reload saved projects" className="p-1 text-[#99999e] disabled:opacity-40"><RefreshCw size={13} /></button>
        </div>
        {workspace.listError && <p role="alert" className="mt-2 text-xs text-[#ffaaaa]">{workspace.listError}</p>}
        {workspace.listBusy && <p role="status" className="mt-2 text-xs text-[#99999e]">Loading projects...</p>}
        {!workspace.listBusy && !workspace.listError && workspace.projects.length === 0 && <p className="mt-2 text-xs text-[#99999e]">No saved projects yet.</p>}
        <div className="mt-2 space-y-1">
          {workspace.projects.map((saved) => (
            <button key={saved.id} type="button" onClick={() => workspace.navigate(saved.id)} disabled={busy} aria-pressed={saved.id === workspace.selectedProjectId} className={`flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left text-xs disabled:opacity-40 ${saved.id === workspace.selectedProjectId ? "bg-[#29292c] text-white" : "text-[#a0a0a5] hover:bg-[#222224]"}`}>
              <span className="truncate">{saved.name}</span><span className="shrink-0 text-[10px] text-[#99999e]">{saved.latestRevision ? `v${saved.latestRevision.version}` : "Draft"}</span>
            </button>
          ))}
        </div>
        {workspace.projectCursor && <button type="button" disabled={busy || workspace.listBusy} onClick={() => void workspace.loadMoreProjects()} className="mt-2 text-xs text-[#b6f09c] disabled:opacity-40">Load more projects</button>}
      </section>

      <section className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-[#2b2b2e] px-4 py-3">
          <Sparkles size={14} className="text-[#b6f09c]" /><h2 className="text-xs font-medium">{project?.name ?? "Agent"}</h2>
          {revision && <span className="ml-auto text-[10px] text-[#99999e]">Viewing v{revision.version}</span>}
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-xs">
          {workspace.loadBusy && <p role="status" className="text-[#99999e]">Loading saved workspace...</p>}
          {workspace.loadError && <div role="alert" className="text-[#ffaaaa]"><p>{workspace.loadError}</p><button type="button" disabled={busy} onClick={workspace.refreshSelection} className="mt-2 underline">Retry loading</button></div>}
          {!workspace.selectedProjectId && !workspace.loadError && <p className="py-8 text-center text-[#99999e]">Build a frontend page or reopen a project above.</p>}
          {project && !revision && <p className="text-[#99999e]">Saved draft. No generated files yet.</p>}
          {revision && (
            <div className="space-y-2 rounded-lg border border-[#34432f] bg-[#182016] p-3 text-[#b6f09c]">
              <p>{revision.summary}</p>
              <p className="text-[10px] text-[#a5b99c]">{revision.files.length} files · {revision.model ?? "Model unknown (legacy)"}{revision.usage ? ` · ${revision.usage.totalTokens} tokens` : " · Usage unknown"}</p>
              <p className="text-[10px] text-[#a5b99c]">{revision.parentRevisionId ? (parentVersion ? `Parent: v${parentVersion}` : `Parent: ${revision.parentRevisionId}`) : revision.validation ? "Initial revision" : "Parent unknown (legacy)"}</p>
              {project?.latestRevision && revision.id !== project.latestRevision.id && <p className="text-[10px] text-[#e8ce87]">Historical base selected. Latest is v{project.latestRevision.version}.</p>}
              <p className="text-[10px] text-[#a5b99c]">{revision.validation ? "Manifest checked · build/execution not verified" : "Validation unknown (legacy)"}</p>
            </div>
          )}
          {project && (
            <section aria-label="Revision history" className="space-y-2">
              <h3 className="text-[10px] font-semibold tracking-widest text-[#99999e] uppercase">Revision history</h3>
              {workspace.revisions.length === 0 && !workspace.loadBusy && <p className="text-[#99999e]">No saved revisions.</p>}
              {workspace.revisions.map((item) => (
                <button type="button" key={item.id} onClick={() => workspace.navigate(project.id, item.id)} disabled={busy || workspace.loadBusy} aria-pressed={revision?.id === item.id} className={`w-full rounded border p-2 text-left disabled:opacity-40 ${revision?.id === item.id ? "border-[#58734c] bg-[#20281d]" : "border-[#303034] hover:bg-[#222224]"}`}>
                  <span className="text-[#b6f09c]">v{item.version}</span><p className="mt-1 text-[#d6d6d8]">{item.sourcePrompt ?? "Producing prompt unknown (legacy)"}</p><p className="mt-1 text-[10px] text-[#99999e]">{item.summary}</p>
                </button>
              ))}
              {workspace.revisionCursor && <button type="button" disabled={busy || workspace.loadBusy} onClick={() => void workspace.loadMoreRevisions()} className="text-[#b6f09c] disabled:opacity-40">Load older revisions</button>}
            </section>
          )}
        </div>
        <form onSubmit={handleSubmit} className="border-t border-[#2b2b2e] p-3">
          {workspace.submitError && <p role="alert" className="mb-2 text-xs text-[#ffaaaa]">{workspace.submitError}</p>}
          <p role="status" className="mb-2 text-[10px] text-[#99999e]">{busy ? workspace.notice : revision ? `Next prompt creates a new revision from v${revision.version}.` : workspace.notice}</p>
          {pending && !busy && (
            <div className="mb-3 space-y-2 rounded border border-[#655738] p-2 text-[11px] text-[#e8ce87]">
              <p>Unconfirmed attempt retained: {pending.body.prompt ?? "Initial generation"}</p>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => void workspace.submit(true)} className="underline">Retry same attempt</button>
                {pending.generationId && <button type="button" onClick={() => void workspace.checkPending()} className="underline">Check status</button>}
                <button type="button" onClick={workspace.abandonPending} className="underline">Abandon attempt</button>
              </div>
            </div>
          )}
          <div className="rounded-lg border border-[#3a3a3e] bg-[#1c1c1e] p-2 focus-within:border-[#68686e]">
            <label htmlFor="workspace-prompt" className="sr-only">Describe a frontend page or change</label>
            <textarea id="workspace-prompt" value={workspace.prompt} onChange={(event) => workspace.setPrompt(event.target.value)} onKeyDown={handlePromptKeyDown} aria-describedby="workspace-prompt-help" placeholder={revision ? "Describe a change to this revision..." : "Ask AgentForge to build..."} rows={3} maxLength={1000} minLength={10} disabled={!workspace.canSubmit} className="w-full resize-none bg-transparent px-1 text-xs outline-none placeholder:text-[#99999e] disabled:opacity-50" />
            <p id="workspace-prompt-help" className="px-1 text-[10px] text-[#99999e]">Enter to send · Shift+Enter for a new line · Minimum 10 characters</p>
            <div className="mt-2 flex items-center justify-between">
              <span className="px-1 text-[10px] text-[#99999e]">Economy · {workspace.prompt.length}/1000</span>
              <button type="submit" disabled={!workspace.canSubmit || workspace.prompt.trim().length < 10} aria-label="Send prompt" className="grid size-7 place-items-center rounded-md bg-[#dddddf] text-[#111112] disabled:opacity-30">{busy ? "..." : <ArrowUp size={15} />}</button>
            </div>
          </div>
        </form>
      </section>
    </aside>
  );
}
