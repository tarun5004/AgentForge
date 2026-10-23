"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createProject, generateProject, getGeneration, getProject, getRevision,
  listProjects, listRevisions, ProjectApiError,
  type Generation, type GenerationStatus, type Project, type Revision, type RevisionSummary,
} from "@/lib/project-api";
import {
  clearPendingGeneration, readPendingGeneration, savePendingGeneration,
  type PendingGeneration,
} from "@/lib/pending-generation";
import { workspaceUrl, type WorkspaceSelection } from "@/lib/workspace-selection";
import type { SessionAccess } from "@/lib/session-request";
import { pollGeneration } from "@/lib/generation-poll";

export type WorkspaceSnapshot = Pick<Revision, "id" | "version" | "parentRevisionId" | "sourcePrompt" | "summary" | "files" | "fileChanges" | "model" | "usage" | "validation" | "buildVerification">;

// Preserve the committed POST snapshot if a later metadata reload fails; no dates are invented.
function snapshotFromGeneration(result: Generation): WorkspaceSnapshot {
  return {
    id: result.revisionId, version: result.revisionVersion, parentRevisionId: result.parentRevisionId,
    sourcePrompt: result.sourcePrompt, summary: result.summary, files: result.files,
    fileChanges: result.fileChanges, model: result.model, usage: result.usage, validation: result.validation,
    buildVerification: result.buildVerification ?? null,
  };
}

// One readable fallback keeps network failures useful without showing internal server details.
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed. Please try again.";
}

// A confirmed rejection can use a new key; transport errors/503/in-progress must retain it.
function isTerminalGenerationError(error: unknown): boolean {
  if (!(error instanceof ProjectApiError)) return false;
  return [400, 404, 413, 502].includes(error.status) ||
    ["GENERATION_FAILED", "REVISION_CONFLICT", "IDEMPOTENCY_MISMATCH"].includes(error.code ?? "");
}

// State lives above responsive panels. URL IDs select data; Mongo remains the source of files.
export function useWorkspace(
  selection: WorkspaceSelection,
  session: SessionAccess | null,
  userId: string | null,
  invalidateSession: () => void,
) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectCursor, setProjectCursor] = useState<string | null>(null);
  const [listBusy, setListBusy] = useState(true);
  const [listError, setListError] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [revision, setRevision] = useState<WorkspaceSnapshot | null>(null);
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [revisionCursor, setRevisionCursor] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [loadBusy, setLoadBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [notice, setNotice] = useState("Describe a frontend page, or reopen a saved project.");
  const [submitError, setSubmitError] = useState("");
  const [pending, setPending] = useState<PendingGeneration | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const selectionAbort = useRef<AbortController | null>(null);
  const listAbort = useRef<AbortController | null>(null);
  const submissionLock = useRef(false);
  const mounted = useRef(true);
  const pollAbort = useRef<AbortController | null>(null);
  const selectionKey = workspaceUrl(selection.projectId, selection.revisionId);
  const visible = loadedKey === selectionKey;

  // Redirecting alone leaves a stale user cached; clear it before leaving protected UI.
  const reportError = useCallback((error: unknown): string => {
    if (error instanceof ProjectApiError && error.status === 401) {
      invalidateSession();
      router.replace("/login");
      return "Your session expired. Please sign in again.";
    }
    return errorMessage(error);
  }, [router, invalidateSession]);

  // Abort an older list request so load-more/reload cannot reorder sidebar results.
  const loadProjectPage = useCallback(async (cursor: string | null = null) => {
    if (!session) return;
    listAbort.current?.abort();
    const controller = new AbortController();
    listAbort.current = controller;
    setListBusy(true);
    setListError("");
    try {
      const page = await listProjects(session, cursor, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      setProjects((current) => cursor ? [...current, ...page.projects.filter((item) => !current.some((saved) => saved.id === item.id))] : page.projects);
      setProjectCursor(page.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) setListError(reportError(error));
    } finally {
      if (!controller.signal.aborted && mounted.current) setListBusy(false);
    }
  }, [session, reportError]);

  useEffect(() => {
    mounted.current = true;
    if (!session) return;
    const controller = new AbortController();
    listAbort.current = controller;
    // Initial loading is already true. Update state when the external request responds.
    void listProjects(session, null, controller.signal).then((page) => {
      if (controller.signal.aborted) return;
      setProjects(page.projects); setProjectCursor(page.nextCursor); setListError("");
    }).catch((error) => {
      if (!controller.signal.aborted) setListError(reportError(error));
    }).finally(() => {
      if (!controller.signal.aborted) setListBusy(false);
    });
    return () => { mounted.current = false; controller.abort(); listAbort.current?.abort(); selectionAbort.current?.abort(); pollAbort.current?.abort(); };
  }, [session, reportError]);

  useEffect(() => {
    if (!session || !userId || busy || selection.error) return;
    const controller = new AbortController();
    selectionAbort.current = controller;
    // Independent metadata/history requests run together; explicit snapshots can start too.
    async function loadSelection() {
      setLoadBusy(true);
      setLoadError("");
      try {
        if (!selection.projectId) {
          setProject(null); setRevision(null); setRevisions([]); setRevisionCursor(null);
          setLoadedKey(selectionKey); setPending(null);
          return;
        }
        const [savedProject, history, selected] = await Promise.all([
          getProject(selection.projectId, session!, controller.signal),
          listRevisions(selection.projectId, session!, null, controller.signal),
          selection.revisionId ? getRevision(selection.projectId, selection.revisionId, session!, controller.signal) : Promise.resolve(null),
        ]);
        const snapshot = selected ?? (savedProject.latestRevision
          ? await getRevision(savedProject.id, savedProject.latestRevision.id, session!, controller.signal) : null);
        if (controller.signal.aborted || !mounted.current) return;
        setProject(savedProject); setRevision(snapshot); setRevisions(history.revisions); setRevisionCursor(history.nextCursor);
        setLoadedKey(selectionKey);
        const restoredIntent = readPendingGeneration(userId!, savedProject.id);
        setPending(restoredIntent);
        if (restoredIntent) setNotice("Saved attempt restored. Check status or retry the same attempt; no new request key is needed.");
      } catch (error) {
        if (!controller.signal.aborted && mounted.current) setLoadError(reportError(error));
      } finally {
        if (!controller.signal.aborted && mounted.current) setLoadBusy(false);
      }
    }
    void loadSelection();
    return () => controller.abort();
  }, [session, userId, busy, selection.projectId, selection.revisionId, selection.error, selectionKey, reload, reportError]);

  // Invalidate old GETs immediately, before route props arrive from Next navigation.
  function navigate(projectId: string | null, revisionId: string | null = null) {
    if (submissionLock.current) return;
    selectionAbort.current?.abort();
    setLoadedKey(""); setLoadError(""); setSubmitError(""); setPending(null); setPrompt("");
    setNotice(projectId ? "Loading saved project..." : "Your next prompt creates a new project.");
    router.replace(workspaceUrl(projectId, revisionId), { scroll: false });
    // Same-URL selection is a genuine reload, not a no-op navigation.
    setReload((value) => value + 1);
  }

  // Keep pagination tied to its original project even if selection changes mid-request.
  async function loadMoreRevisions() {
    if (!session || !project || !revisionCursor || loadBusy || busy) return;
    const controller = selectionAbort.current;
    if (!controller) return;
    setLoadBusy(true);
    try {
      const page = await listRevisions(project.id, session, revisionCursor, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      setRevisions((current) => [...current, ...page.revisions.filter((item) => !current.some((saved) => saved.id === item.id))]);
      setRevisionCursor(page.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) setLoadError(reportError(error));
    } finally {
      if (!controller.signal.aborted && mounted.current) setLoadBusy(false);
    }
  }

  // A committed response is usable even if its follow-up history refresh is unavailable.
  function acceptGeneration(result: Generation, savedProject: Project) {
    if (!mounted.current) return;
    // The POST proves this version exists even if refreshing latest metadata fails afterward.
    setProject({ ...savedProject, status: "ready", latestRevision: { id: result.revisionId, version: result.revisionVersion } });
    setRevision(snapshotFromGeneration(result));
    setLoadedKey(workspaceUrl(savedProject.id, result.revisionId));
    setPrompt(""); setSubmitError(""); setPending(null);
    setNotice(`Revision v${result.revisionVersion} committed. ${result.files.length} files saved.`);
    router.replace(workspaceUrl(savedProject.id, result.revisionId), { scroll: false });
    void loadProjectPage();
  }

  // Freeze project/base/key for the whole attempt; no UI change may mutate an in-flight request.
  async function submit(retry = false) {
    if (!session || !userId || submissionLock.current || (!retry && (loadBusy || selection.error))) return;
    const text = prompt.trim();
    if (!retry && (text.length < 10 || text.length > 1000 || pending || !visible)) return;
    if (retry && !pending) return;
    submissionLock.current = true; setBusy(true); setSubmitError("");
    let savedProject = project;
    let intent = retry ? pending : null;
    try {
      if (!intent) {
        if (!savedProject) {
          savedProject = await createProject(text, session);
          if (!mounted.current) return;
          setProject(savedProject); setRevision(null); setRevisions([]);
          setLoadedKey(workspaceUrl(savedProject.id));
          router.replace(workspaceUrl(savedProject.id), { scroll: false });
          void loadProjectPage();
        }
        intent = { projectId: savedProject.id, key: crypto.randomUUID(), body: { prompt: text, ...(revision ? { baseRevisionId: revision.id } : {}) } };
        savePendingGeneration(userId, intent); setPending(intent);
      }
      if (!savedProject || savedProject.id !== intent.projectId) throw new Error("Reload this project before retrying.");
      setNotice(intent.body.baseRevisionId ? "Generating changes against the frozen selected revision..." : "Project saved. Generating its first revision...");
      let result: GenerationStatus = await generateProject(intent.projectId, session, intent.key, intent.body);
      if (!mounted.current) return;
      if (result.status === "pending") {
        intent = { ...intent, generationId: result.id };
        savePendingGeneration(userId, intent); setPending(intent);
        setNotice("Attempt accepted. Waiting for generation and build verification; saved files stay unchanged...");
        const controller = new AbortController();
        pollAbort.current = controller;
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(360_000)]);
        const projectId = intent.projectId;
        const generationId = result.id;
        result = await pollGeneration(generationId, () => getGeneration(projectId, generationId, session,
          AbortSignal.any([signal, AbortSignal.timeout(10_000)])), signal);
      }
      if (result.status === "failed") throw new ProjectApiError("Generation or build verification failed. Saved files remain unchanged.", 502, "GENERATION_FAILED", result.id);
      clearPendingGeneration(userId, intent.projectId);
      acceptGeneration(result, savedProject);
    } catch (error) {
      if (!mounted.current) return;
      if (intent) {
        if (error instanceof ProjectApiError && error.generationId) intent = { ...intent, generationId: error.generationId };
        const terminal = isTerminalGenerationError(error);
        if (terminal) { clearPendingGeneration(userId, intent.projectId); setPending(null); }
        else { savePendingGeneration(userId, intent); setPending(intent); setNotice("Completion is not confirmed. Check status or retry the same attempt."); }
        setSubmitError(`${reportError(error)} ${terminal ? "Saved files are unchanged; a new submission uses a new key." : "Outcome not confirmed. Check status or retry this same attempt."}`);
      } else {
        setSubmitError(`${reportError(error)} Check saved projects before creating another draft.`);
        void loadProjectPage();
      }
    } finally {
      submissionLock.current = false;
      if (mounted.current) { setBusy(false); setReload((value) => value + 1); }
    }
  }

  // Explicit status checks do not retry AI; ready evidence loads the committed snapshot.
  async function checkPending() {
    if (!pending?.generationId || !session || !project || busy) return;
    submissionLock.current = true; setBusy(true); setSubmitError("");
    try {
      const result = await getGeneration(pending.projectId, pending.generationId, session);
      if (!mounted.current) return;
      if (result.status === "ready") {
        if (userId) clearPendingGeneration(userId, pending.projectId);
        acceptGeneration(result, project);
      } else if (result.status === "failed") {
        if (userId) clearPendingGeneration(userId, pending.projectId);
        setPending(null); setSubmitError(`Attempt failed: ${result.errorCode ?? "GENERATION_FAILED"}. Saved files remain available.`);
      } else setNotice(result.hasSavedResult ? "Output is saved; verification or publication is not confirmed. Check status or retry the same attempt." : "Attempt is pending; completion is not yet confirmed.");
    } catch (error) { if (mounted.current) setSubmitError(reportError(error)); }
    finally { submissionLock.current = false; if (mounted.current) setBusy(false); }
  }

  // Abandoning a key is not cancellation; another model request can cost additional tokens.
  function abandonPending() {
    if (!pending || !userId || busy || !window.confirm("This does not cancel server work. A new attempt may spend tokens again. Abandon this request key?")) return;
    clearPendingGeneration(userId, pending.projectId); setPending(null);
    setPrompt(pending.body.prompt ?? project?.initialPrompt ?? "");
    setNotice("Old attempt abandoned locally. Review the latest revision before submitting again.");
    setReload((value) => value + 1);
  }

  return {
    projects, projectCursor, listBusy, listError, project: visible ? project : null,
    revision: visible ? revision : null, revisions: visible ? revisions : [], revisionCursor,
    loadBusy, loadError: selection.error || loadError, prompt, setPrompt, notice, submitError,
    pending: visible ? pending : null, busy,
    canSubmit: !busy && !loadBusy && !selection.error && !pending && visible,
    selectedProjectId: selection.projectId,
    navigate, submit, checkPending, abandonPending, loadMoreRevisions,
    loadMoreProjects: () => loadProjectPage(projectCursor), refreshProjects: () => loadProjectPage(),
    refreshSelection: () => setReload((value) => value + 1),
  };
}

export type WorkspaceState = ReturnType<typeof useWorkspace>;
