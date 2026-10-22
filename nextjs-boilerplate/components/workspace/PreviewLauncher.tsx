"use client";

import { Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { RunApiError, startRun, updateRun, type PreviewRun } from "@/lib/run-api";

type Target = { projectId: string; revisionId: string };
type Action = "start" | "read" | "stop" | "activity";

// Keyed by user/project/revision in the shell, so navigation cannot reuse an old preview target.
export function PreviewLauncher({ projectId, revisionId, disabled }: { projectId: string | null; revisionId: string | null; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" disabled={disabled || !projectId || !revisionId} onClick={() => setOpen(true)}
      title="Build and preview the selected saved revision"
      className="flex items-center gap-1.5 rounded-md bg-[#dddddf] px-3 py-1.5 text-[10px] font-medium text-[#111112] disabled:cursor-not-allowed disabled:opacity-50">
      <Play size={11} fill="currentColor" /> Preview
    </button>
    {open && projectId && revisionId && <PreviewDialog projectId={projectId} revisionId={revisionId} onClose={() => setOpen(false)} />}
  </>;
}

// Native modal focus/inert behavior keeps the selected project frozen while a build is running.
function PreviewDialog({ projectId, revisionId, onClose }: Target & { onClose: () => void }) {
  const { projectSession, invalidateSession } = useAuth();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const currentRun = useRef<PreviewRun | null>(null);
  const [run, setRun] = useState<PreviewRun | null>(null);
  const [operation, setOperation] = useState<Action | null>("start");
  const [error, setError] = useState("");

  // Superseding a poll (especially Stop) aborts it so a late ready response cannot reopen an iframe.
  const perform = useCallback(async (action: Action) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]);
    try {
      let next = action === "start" || !currentRun.current
        ? await startRun(projectId, revisionId, projectSession, signal)
        : await updateRun(currentRun.current.id, action, projectSession, signal);
      for (;;) {
        signal.throwIfAborted();
        if (next.projectId !== projectId || next.revisionId !== revisionId) throw new Error("Preview selection changed.");
        currentRun.current = next;
        setRun(next);
        if (next.state !== "building" && next.state !== "cancelling") break;
        // One small bounded poll, not an interactive terminal or an automatic AI retry.
        await new Promise((resolve) => setTimeout(resolve, 1000));
        signal.throwIfAborted();
        next = await updateRun(next.id, "read", projectSession, signal);
      }
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof RunApiError && failure.status === 401) {
        invalidateSession();
        router.replace("/login");
      } else setError(failure instanceof Error ? failure.message : "Preview failed. Try again.");
    } finally {
      if (!controller.signal.aborted) setOperation(null);
    }
  }, [projectId, revisionId, projectSession, invalidateSession, router]);

  // User actions reset UI synchronously; mounting already starts with the correct loading state.
  function handleAction(action: Action) {
    setOperation(action);
    setError("");
    void perform(action);
  }

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    void perform("start");
    return () => { activeRequest.current?.abort(); element?.close(); };
  }, [perform]);

  const busy = operation !== null;
  const canStop = run && ["building", "cancelling", "ready"].includes(run.state);
  const cleanupUnknown = run?.errorCode === "CLEANUP_UNCONFIRMED";
  return <dialog ref={dialog} aria-labelledby="preview-title" onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }}
    className="m-auto h-[85dvh] w-[94vw] max-w-6xl rounded-lg border border-[#353539] bg-[#181819] p-0 text-[#dddddf] backdrop:bg-black/70">
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#353539] p-3">
        <h2 id="preview-title" className="mr-auto text-sm font-medium">Saved revision preview</h2>
        {canStop && <button type="button" disabled={operation === "stop"} onClick={() => handleAction("stop")} className="rounded border border-[#55555a] px-3 py-1 text-xs disabled:opacity-50">Stop preview</button>}
        <button type="button" disabled={busy} onClick={onClose} className="rounded border border-[#55555a] px-3 py-1 text-xs disabled:opacity-50">Close preview</button>
      </header>
      <div className="space-y-2 p-3 text-xs">
        <p role="status">{operation === "stop" ? "Stopping preview; waiting for cleanup..." : run?.message ?? "Starting the local build..."}</p>
        <p className="text-[#99999e]">Static frontend only · no interactive terminal · expires after 30 minutes idle.</p>
        {error && <p role="alert" className="text-red-300">{error}</p>}
        {!busy && !cleanupUnknown && (error || run?.state !== "ready") && <button type="button" onClick={() => handleAction(error && run && ["building", "cancelling", "ready"].includes(run.state) ? "read" : "start")} className="underline">Retry preview</button>}
        {run?.state === "ready" && <button type="button" disabled={busy} onClick={() => handleAction("activity")} className="underline disabled:opacity-50">Keep preview alive</button>}
      </div>
      {run?.state === "ready" && run.previewUrl && operation !== "stop"
        ? <iframe title="Generated frontend preview" src={run.previewUrl} sandbox="allow-scripts" referrerPolicy="no-referrer" className="min-h-0 w-full flex-1 border-0 bg-white" />
        : <div className="grid flex-1 place-items-center p-6 text-sm text-[#99999e]">{run?.state === "failed" ? "No preview was published." : "Preview will appear after a successful build."}</div>}
    </div>
  </dialog>;
}
