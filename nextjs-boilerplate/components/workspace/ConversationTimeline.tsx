"use client";

import { useEffect, useRef } from "react";
import { CircleAlert, FilePenLine, LoaderCircle, Sparkles } from "lucide-react";
import Markdown from "react-markdown";
import type { WorkspaceState } from "./useWorkspace";

// Keep model text as safe Markdown: no raw HTML, embedded images or executable widgets.
function AssistantText({ text }: { text: string }) {
  return <div className="space-y-2 break-words [&_code]:rounded [&_code]:bg-[#29292c] [&_code]:px-1 [&_li]:ml-4 [&_ol]:list-decimal [&_p]:whitespace-pre-wrap [&_pre]:overflow-auto [&_pre]:p-2 [&_ul]:list-disc">
    <Markdown skipHtml allowedElements={["p", "ul", "ol", "li", "strong", "em", "code", "pre", "blockquote", "h3", "h4"]}>{text}</Markdown>
  </div>;
}

// One transcript joins user prompts, real service activity, requirements and committed results.
export function ConversationTimeline({ workspace, onPreview }: { workspace: WorkspaceState; onPreview: () => void }) {
  const scroll = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const conversation = workspace.conversation;

  useEffect(() => {
    followLatest.current = true;
  }, [workspace.selectedProjectId]);

  useEffect(() => {
    if (followLatest.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [conversation?.entries, workspace.busy]);

  return <div ref={scroll} onScroll={(event) => {
    const element = event.currentTarget;
    followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  }} className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-[13px] leading-[22px]">
    {workspace.loadBusy && <p role="status" className="text-[#99999e]">Loading saved workspace...</p>}
    {workspace.loadError && <div role="alert" className="text-[#ffaaaa]">
      <p>{workspace.loadError}</p><button type="button" disabled={workspace.busy} onClick={workspace.refreshSelection} className="underline">Retry loading</button>
    </div>}
    {!conversation?.entries.length && !workspace.selectedProjectId && !workspace.loadError && <div className="py-10">
      <Sparkles size={22} className="mb-4 text-[#b6f09c]" />
      <h3 className="text-base font-medium text-[#ededee]">What can I help with?</h3>
      <p className="mt-2 text-[#99999e]">Ask a question, plan a website, or build a frontend. Your conversation stays here.</p>
      <p className="mt-3 text-xs text-[#77777c]">React / Next.js frontend · local Docker preview</p>
    </div>}
    {conversation?.warning && <p role="alert" className="mb-4 text-xs text-[#e8ce87]">{conversation.warning}</p>}
    {conversation?.trimmed && <p className="mb-4 text-xs text-[#99999e]">Older local messages were trimmed to keep storage small. Saved revisions remain available in history.</p>}
    <div role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text" className="space-y-6">
      {conversation?.entries.map((entry) => <article key={entry.id} aria-label={entry.role === "user" ? "Your message" : entry.kind === "activity" ? "Agent activity" : "Agent response"}>
        {entry.role === "user" ? <div className="ml-5 rounded-xl bg-[#3b3b3b] px-3 py-2.5">
          <p className="mb-1 text-[10px] font-medium text-[#b5b5b5]">You</p>
          <p className="whitespace-pre-wrap break-words">{entry.text}</p>
          {entry.details?.map((line) => <p key={line} className="mt-1 break-all text-[10px] text-[#99999e]">{line}</p>)}
        </div> : entry.kind === "activity" ? <details role={entry.state === "error" ? "alert" : undefined} className="text-xs text-[#b0b0b0]">
          <summary className="flex cursor-pointer list-none items-start gap-2 hover:text-[#d6d6d8]">
            {entry.state === "working" ? <LoaderCircle size={14} className="mt-1 shrink-0 motion-safe:animate-spin" />
              : entry.state === "done" ? <FilePenLine size={14} className="mt-1 shrink-0" /> : <CircleAlert size={14} className="mt-1 shrink-0 text-[#e8ce87]" />}
            <span>{entry.text}<span className="ml-2 text-[10px] text-[#77777c]">Details</span></span>
          </summary>
          <ul className="mt-2 space-y-1 pl-5">{entry.details?.map((line, index) => <li key={`${index}:${line}`}>{line}</li>)}</ul>
        </details> : <div className="space-y-2">
          {entry.kind === "result" && <p className="font-medium">Result</p>}
          <AssistantText text={entry.text} />
          {workspace.revision && entry.revisionId === workspace.revision.id && <p className="text-[10px] text-[#99999e]">{workspace.revision.buildVerification
            ? "Manifest checked · static build verified" : workspace.revision.validation
              ? "Manifest checked · build/execution not verified" : "Validation unknown (legacy)"}</p>}
          {entry.details && <details className="text-xs text-[#a0a0a5]" open={entry.kind === "requirements"}>
            <summary className="cursor-pointer hover:text-white">{entry.kind === "result" ? "Changed files and verification" : entry.kind === "requirements" ? "Saved project brief" : "Run report"}</summary>
            <ul className="mt-2 space-y-1 border-l border-[#38383c] pl-3">{entry.details.map((line, index) => <li key={index} className="whitespace-pre-wrap break-words">{line}</li>)}</ul>
          </details>}
          {entry.revisionId && <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
            <button type="button" disabled={workspace.busy || workspace.loadBusy} onClick={() => workspace.navigate(workspace.project!.id, entry.revisionId)} className="text-[#b6f09c] underline disabled:opacity-40">{workspace.revision?.id === entry.revisionId ? "Viewing saved files" : "Open revision"}</button>
            {workspace.revision?.id === entry.revisionId && <button type="button" disabled={workspace.busy || workspace.loadBusy} onClick={onPreview} className="rounded border border-[#45454a] px-2 py-1 disabled:opacity-40">Preview this revision</button>}
          </div>}
        </div>}
      </article>)}
    </div>
  </div>;
}
