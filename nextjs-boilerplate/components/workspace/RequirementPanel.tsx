"use client";

import { isBriefAnswers } from "@/lib/requirement-brief";
import type { WorkspaceState } from "./useWorkspace";

// Render only saved requirements/plain text; model output never becomes HTML or consent.
export function RequirementPanel({ workspace }: { workspace: WorkspaceState }) {
  const { brief, briefIntent, busy, pending, answerDrafts, briefError } = workspace;
  const disabled = busy || workspace.loadBusy || !!pending || !!workspace.loadError;
  const ready = brief?.status === "completed" && brief.assessment?.status === "ready";
  const canAssess = !disabled && !briefIntent && !briefError && brief?.status !== "pending" && isBriefAnswers(answerDrafts);

  return (
    <section aria-label="Project requirements" className="space-y-3 rounded-lg border border-[#38383c] bg-[#1c1c1e] p-3">
      <h3 className="font-medium text-[#ededee]">Next action {brief ? `· brief v${brief.version}` : ""}</h3>
      <p className="text-[10px] text-[#99999e]">Saved draft. No generated files yet.</p>
      <button type="button" disabled={disabled} onClick={() => void workspace.actOnBrief("reload")} className="text-[#b6f09c] underline disabled:opacity-40">Reload requirements</button>
      {briefError && <p role="alert" className="text-[#ffaaaa]">{briefError} Read/replay before starting another attempt.</p>}
      {briefIntent && (
        <div className="space-y-2 rounded border border-[#655738] p-2 text-[#e8ce87]">
          <p>Assessment outcome retained. Replay reuses this key; a request never received by the server may start its first call.</p>
          <button type="button" disabled={disabled} onClick={() => void workspace.actOnBrief("assess", true)} className="underline disabled:opacity-40">Replay assessment</button>
        </div>
      )}
      {brief?.status === "pending" && <div className="space-y-2 text-[#e8ce87]">
        <p role="status">Assessment pending. Reload first; abandonment cannot refund a possible model call.</p>
        <button type="button" disabled={disabled} onClick={() => void workspace.actOnBrief("abandon")} className="underline disabled:opacity-40">Abandon pending assessment</button>
      </div>}
      {brief?.status === "failed" && <p role="alert" className="text-[#e8ce87]">Assessment ended: {brief.errorCode}. A deliberate new assessment may spend again.</p>}
      {brief?.assessment && <>
        <p className="text-[10px] text-[#99999e]">{brief.assessment.model} · {brief.assessment.usage.totalTokens === null ? "Usage unknown" : `${brief.assessment.usage.totalTokens} tokens`}</p>
        {brief.assessment.status === "unsupported" && <p className="text-[#e8ce87]">This request is outside the frontend-only scope. Start a new conversation with a supported request.</p>}
      </>}
      {answerDrafts.length > 0 && <form onSubmit={(event) => { event.preventDefault(); if (canAssess) void workspace.actOnBrief("assess"); }} className="space-y-3">
        {answerDrafts.map((item, index) => <label key={item.question} className="block space-y-1">
          <span>{item.question}</span>
          <textarea value={item.answer} onChange={(event) => workspace.editBriefAnswer(index, event.target.value)}
            maxLength={1000} required rows={2} disabled={disabled || !!briefIntent || brief?.status === "pending"}
            className="w-full rounded border border-[#45454a] bg-[#151516] p-2 text-xs outline-none focus:border-[#b6f09c] disabled:opacity-50" />
        </label>)}
        {answerDrafts.length > 6 && <p role="alert" className="text-[#e8ce87]">Six-answer context limit reached. No answers will be silently dropped. Start a new, more complete request.</p>}
        <button type="submit" disabled={!canAssess || (ready && !workspace.briefDirty)} className="rounded border border-[#58734c] px-3 py-2 text-[#b6f09c] disabled:opacity-40">Save answers and reassess</button>
      </form>}
      {!brief && <button type="button" disabled={!canAssess} onClick={() => void workspace.actOnBrief("assess")} className="rounded border border-[#58734c] px-3 py-2 text-[#b6f09c] disabled:opacity-40">Assess saved request</button>}
      {brief?.status === "failed" && <button type="button" disabled={!canAssess} onClick={() => void workspace.actOnBrief("assess")} className="underline disabled:opacity-40">Start new assessment (may spend again)</button>}
      {ready && <div className="space-y-2">
        <p className="text-[#99999e]">{workspace.briefDirty ? "Answers changed. Reassess before confirming or generating." : brief.confirmedAt ? "This saved brief is confirmed." : "Ready for review is not approval. Confirm only if these details are correct."}</p>
        {!brief.confirmedAt ? <button type="button" disabled={disabled || !!briefIntent || !!briefError || workspace.briefDirty}
          onClick={() => void workspace.actOnBrief("confirm")} className="rounded border border-[#58734c] px-3 py-2 text-[#b6f09c] disabled:opacity-40">Confirm brief</button>
          : <button type="button" disabled={disabled || !!briefIntent || !!briefError || workspace.briefDirty}
            onClick={() => void workspace.generateBrief()} className="rounded bg-[#b6f09c] px-3 py-2 font-medium text-[#151516] disabled:opacity-40">Generate code</button>}
      </div>}
    </section>
  );
}
