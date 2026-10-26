"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createProject, generateProject, getGeneration, getProject, getRevision,
  listProjects, listRevisions, ProjectApiError,
  getRequirementBrief, generateConfirmedBrief,
  type Generation, type GenerationStatus, type Project, type Revision, type RevisionSummary,
} from "@/lib/project-api";
import {
  clearPendingGeneration, readPendingGeneration, savePendingGeneration,
  type PendingGeneration,
} from "@/lib/pending-generation";
import { workspaceUrl, type WorkspaceSelection } from "@/lib/workspace-selection";
import type { SessionAccess } from "@/lib/session-request";
import { pollGeneration } from "@/lib/generation-poll";
import { generationActivity } from "@/lib/conversation";
import { useConversation } from "./useConversation";
import type { RequirementBrief } from "@/lib/requirement-brief";
import { sendConversation, conversationContext, conversationReport } from "@/lib/conversation-api";

export type WorkspaceSnapshot = Pick<Revision, "id" | "version" | "parentRevisionId" | "sourcePrompt" | "summary" | "files" | "fileChanges" | "model" | "usage" | "validation" | "buildVerification">;

// Saved proof controls the labels; opening a historical revision cannot invent build/tool success.
function revisionDetails(snapshot: WorkspaceSnapshot): string[] {
  return [
    `Saved v${snapshot.version} · ${snapshot.files.length} files · ${snapshot.model ?? "Model unknown (legacy)"}${snapshot.usage ? ` · ${snapshot.usage.totalTokens} tokens` : " · Usage unknown"}`,
    snapshot.parentRevisionId ? `Parent revision: ${snapshot.parentRevisionId}` : snapshot.validation ? "Initial revision" : "Parent unknown (legacy)",
    snapshot.buildVerification ? "Static build passed for this snapshot." : "Static build not verified for this revision.",
    ...(snapshot.fileChanges?.map((file) => `${file.status} ${file.path}`) ?? ["Change metadata unavailable (legacy)."]),
  ];
}

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
  const chat = useConversation(userId);
  const restoreChat = chat.restore;
  const writeChat = chat.write;
  const restoreDraft = chat.restoreDraft;
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
  const [notice, setNotice] = useState("Ask a question, plan a website, or describe what to build.");
  const [submitError, setSubmitError] = useState("");
  const [pending, setPending] = useState<PendingGeneration | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const selectionAbort = useRef<AbortController | null>(null);
  const listAbort = useRef<AbortController | null>(null);
  const submissionLock = useRef(false);
  const mounted = useRef(true);
  const account = useRef(userId);
  const pollAbort = useRef<AbortController | null>(null);
  const selectionKey = workspaceUrl(selection.projectId, selection.revisionId);
  const visible = loadedKey === selectionKey;

  useEffect(() => { account.current = userId; }, [userId]);

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
          restoreDraft();
          return;
        }
        const [savedProject, history, selected] = await Promise.all([
          getProject(selection.projectId, session!, controller.signal),
          listRevisions(selection.projectId, session!, null, controller.signal),
          selection.revisionId ? getRevision(selection.projectId, selection.revisionId, session!, controller.signal) : Promise.resolve(null),
        ]);
        const snapshot = selected ?? (savedProject.latestRevision
          ? await getRevision(savedProject.id, savedProject.latestRevision.id, session!, controller.signal) : null);
        let savedBrief: RequirementBrief | null = null;

        // Requirements remain part of the conversation even after its first revision is published.
        if (savedProject) {
          try { savedBrief = await getRequirementBrief(savedProject.id, session!, controller.signal); }
          catch (error) { if (!controller.signal.aborted && error instanceof ProjectApiError && error.status === 401) throw error; }
        }
        if (controller.signal.aborted || !mounted.current) return;
        setProject(savedProject); setRevision(snapshot); setRevisions(history.revisions); setRevisionCursor(history.nextCursor);
        setLoadedKey(selectionKey);
        restoreChat(savedProject, history.revisions);
        if (snapshot) writeChat(savedProject.id, { id: `revision:${snapshot.id}`, role: "assistant", kind: "result",
          text: snapshot.summary, revisionId: snapshot.id, details: revisionDetails(snapshot), state: "done" });
        if (savedBrief?.assessment) writeChat(savedProject.id, {
          id: `requirements:${savedBrief.id}`, role: "assistant", kind: "requirements", text: savedBrief.assessment.message,
          details: [savedBrief.assessment.brief, ...savedBrief.assessment.questions], state: "done", createdAt: savedBrief.createdAt,
        });
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
  }, [session, userId, busy, selection.projectId, selection.revisionId, selection.error, selectionKey, reload, reportError, restoreChat, restoreDraft, writeChat]);

  // Invalidate old GETs immediately, before route props arrive from Next navigation.
  function navigate(projectId: string | null, revisionId: string | null = null) {
    if (submissionLock.current) return;
    selectionAbort.current?.abort();
    setLoadedKey(""); setLoadError(""); setSubmitError(""); setPending(null); setPrompt("");
    if (!projectId) chat.resetDraft();
    setNotice(projectId ? "Loading saved project..." : "Ask a question or describe what to build.");
    router.replace(workspaceUrl(projectId, revisionId), { scroll: false });
    // Same-URL selection is a genuine reload, not a no-op navigation.
    setReload((value) => value + 1);
  }

  // One model decides how to help; only a build response enters the existing generation workflow.
  async function sendMessage() {
    const text = prompt.trim();
    if (!session || !userId || !text || text.length > 1000 || submissionLock.current || !visible || loadBusy || loadError || pending) return;
    const threadId = project?.id ?? "draft";
    const requestId = crypto.randomUUID();
    const requestUrl = window.location.pathname + window.location.search;
    // Browser Back/Forward is still available while request buttons are locked.
    const stillSelected = () => mounted.current && account.current === userId && window.location.pathname + window.location.search === requestUrl;
    const context = conversationContext(chat.entries(threadId), text);
    submissionLock.current = true; setBusy(true); setSubmitError("");
    selectionAbort.current?.abort();
    chat.write(threadId, { id: `chat:${requestId}:user`, role: "user", kind: "message", text });
    chat.activity(threadId, `chat:${requestId}`, "Waiting for the AI response.", "working",
      context.trimmed ? ["Only the recent conversation fits in this request; older displayed messages were not sent."] : []);
    let buildPrompt: string | undefined;
    try {
      const response = await sendConversation({
        messages: context.messages, ...(project ? { projectId: project.id } : {}),
        ...(revision ? { baseRevisionId: revision.id } : {}),
      }, session);
      if (!stillSelected()) return;
      chat.activity(threadId, `chat:${requestId}`, "AI response received.", "done", conversationReport(response));
      chat.write(threadId, { id: `chat:${requestId}:assistant`, role: "assistant", kind: "message",
        text: response.message, details: conversationReport(response), state: "done" });
      setNotice("");
      if (response.action === "build") buildPrompt = response.prompt!;
      else setPrompt("");
    } catch (error) {
      if (!stillSelected()) return;
      const message = reportError(error);
      chat.activity(threadId, `chat:${requestId}`, message, "error");
      setNotice("Your message is kept below. Send again deliberately when ready; nothing is retried automatically.");
    } finally {
      submissionLock.current = false;
      if (mounted.current) setBusy(false);
    }
    if (buildPrompt && stillSelected()) await submit(false, buildPrompt);
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
      const history = [...revisions, ...page.revisions.filter((item) => !revisions.some((saved) => saved.id === item.id))];
      setRevisions(history);
      chat.restore(project, history);
      setRevisionCursor(page.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) setLoadError(reportError(error));
    } finally {
      if (!controller.signal.aborted && mounted.current) setLoadBusy(false);
    }
  }

  // A committed response is usable even if its follow-up history refresh is unavailable.
  function acceptGeneration(result: Generation, savedProject: Project, attemptKey?: string) {
    if (!mounted.current) return;
    // The POST proves this version exists even if refreshing latest metadata fails afterward.
    setProject({ ...savedProject, status: "ready", latestRevision: { id: result.revisionId, version: result.revisionVersion } });
    setRevision(snapshotFromGeneration(result));
    setLoadedKey(workspaceUrl(savedProject.id, result.revisionId));
    setPrompt(""); setSubmitError(""); setPending(null);
    setNotice(`Revision v${result.revisionVersion} committed. ${result.files.length} files saved.`);
    if (attemptKey) chat.activity(savedProject.id, `generation:${attemptKey}`,
      `Revision v${result.revisionVersion} is ready.`, "done", generationActivity(result));
    chat.write(savedProject.id, { id: `revision:${result.revisionId}`, role: "assistant", kind: "result",
      text: result.summary, state: "done", revisionId: result.revisionId,
      details: revisionDetails(snapshotFromGeneration(result)),
    });
    router.replace(workspaceUrl(savedProject.id, result.revisionId), { scroll: false });
    void loadProjectPage();
  }

  // Freeze project/base/key for the whole attempt; no UI change may mutate an in-flight request.
  async function submit(retry = false, generationPrompt?: string) {
    if (!session || !userId || submissionLock.current || (!retry && (loadBusy || selection.error))) return;
    if (!retry && generationPrompt === undefined) { await sendMessage(); return; }
    const text = (generationPrompt ?? prompt).trim();
    if (!retry && (pending || !visible || loadError)) return;
    if (!retry && (text.length < 10 || text.length > 1000)) return;
    if (retry && !pending) return;
    const allowedUrls = new Set([window.location.pathname + window.location.search]);
    // Admit only the project URL transition made deliberately by this operation.
    const stillSelected = () => mounted.current && account.current === userId && allowedUrls.has(window.location.pathname + window.location.search);
    submissionLock.current = true; setBusy(true); setSubmitError("");
    let savedProject = project;
    let intent = retry ? pending : null;
    try {
      if (!intent) {
        if (!savedProject) {
          savedProject = await createProject(text, session);
          if (!stillSelected()) return;
          setProject(savedProject); setRevision(null); setRevisions([]);
          chat.adoptProject(savedProject);
          setLoadedKey(workspaceUrl(savedProject.id));
          allowedUrls.add(workspaceUrl(savedProject.id));
          router.replace(workspaceUrl(savedProject.id), { scroll: false });
          void loadProjectPage();
        }
        intent = { projectId: savedProject.id, key: crypto.randomUUID(),
          body: { prompt: text, ...(revision ? { baseRevisionId: revision.id } : {}) },
        };
        savePendingGeneration(userId, intent); setPending(intent);
      }
      if (!savedProject || savedProject.id !== intent.projectId) throw new Error("Reload this project before retrying.");
      if (retry) chat.write(savedProject.id, { id: `generation:${intent.key}:request`, role: "user", kind: "message",
        text: intent.body.prompt ?? "Generate code from the confirmed brief.",
        details: intent.body.baseRevisionId ? [`Selected base: ${intent.body.baseRevisionId}`] : undefined,
      });
      chat.activity(savedProject.id, `generation:${intent.key}`, "Generation requested. Waiting for validated model output.", "working");
      setNotice(intent.body.baseRevisionId ? "Generating changes against the frozen selected revision..." : "Project saved. Generating its first revision...");
      let result: GenerationStatus = intent.briefId
        ? await generateConfirmedBrief(intent.projectId, intent.briefId, session, intent.key)
        : await generateProject(intent.projectId, session, intent.key, intent.body);
      if (!stillSelected()) return;
      const activityId = `generation:${intent.key}`;
      const activityProjectId = intent.projectId;
      // Polling reports persisted evidence; it never guesses when a tool or build has finished.
      const recordProgress = (status: GenerationStatus) => chat.activity(activityProjectId, activityId,
        status.status === "pending" ? "Waiting for verification/publication; saved files stay unchanged." : "Generation status received.",
        status.status === "pending" ? "working" : status.status === "failed" ? "error" : "done", generationActivity(status));
      recordProgress(result);
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
          AbortSignal.any([signal, AbortSignal.timeout(10_000)])), signal, undefined, recordProgress);
      }
      if (result.status === "failed") throw new ProjectApiError("Generation or build verification failed. Saved files remain unchanged.", 502, "GENERATION_FAILED", result.id);
      if (!stillSelected()) return;
      clearPendingGeneration(userId, intent.projectId);
      acceptGeneration(result, savedProject, intent.key);
    } catch (error) {
      if (!stillSelected()) return;
      if (intent) {
        if (error instanceof ProjectApiError && error.generationId) intent = { ...intent, generationId: error.generationId };
        const terminal = isTerminalGenerationError(error);
        chat.activity(intent.projectId, `generation:${intent.key}`, errorMessage(error), terminal ? "error" : "unknown");
        if (terminal) { clearPendingGeneration(userId, intent.projectId); setPending(null); setNotice("Saved files are unchanged. You can revise the message and send again."); }
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
    const requestUrl = window.location.pathname + window.location.search;
    submissionLock.current = true; setBusy(true); setSubmitError("");
    try {
      const result = await getGeneration(pending.projectId, pending.generationId, session);
      if (!mounted.current || account.current !== userId || window.location.pathname + window.location.search !== requestUrl) return;
      if (result.status === "ready") {
        if (userId) clearPendingGeneration(userId, pending.projectId);
        acceptGeneration(result, project, pending.key);
      } else if (result.status === "failed") {
        if (userId) clearPendingGeneration(userId, pending.projectId);
        setPending(null); setSubmitError(`Attempt failed: ${result.errorCode ?? "GENERATION_FAILED"}. Saved files remain available.`);
        chat.activity(project.id, `generation:${pending.key}`, "Attempt failed. Saved files remain available.", "error", generationActivity(result));
      } else {
        setNotice(result.hasSavedResult ? "Output is saved; verification or publication is not confirmed. Check status or retry the same attempt." : "Attempt is pending; completion is not yet confirmed.");
        chat.activity(project.id, `generation:${pending.key}`, "Status checked; completion is not confirmed.", "unknown", generationActivity(result));
      }
    } catch (error) { if (mounted.current) setSubmitError(reportError(error)); }
    finally { submissionLock.current = false; if (mounted.current) setBusy(false); }
  }

  // Abandoning a key is not cancellation; another model request can cost additional tokens.
  function abandonPending() {
    if (!pending || !userId || busy || !window.confirm("This does not cancel server work. A new attempt may spend tokens again. Abandon this request key?")) return;
    clearPendingGeneration(userId, pending.projectId); setPending(null);
    chat.activity(pending.projectId, `generation:${pending.key}`, "Attempt abandoned locally. Server work was not cancelled.", "unknown");
    setPrompt(pending.body.prompt ?? project?.initialPrompt ?? "");
    setNotice("Old attempt abandoned locally. Review the latest revision before submitting again.");
    setReload((value) => value + 1);
  }

  return {
    conversation: visible && chat.view.userId === userId && chat.view.projectId === (project?.id ?? "draft") ? chat.view.conversation : null,
    recordPreview: chat.activity,
    // Clearing UI history is separate from deleting saved work or abandoning a paid request.
    clearLocalChat: () => {
      if (busy || !window.confirm("Clear this browser's chat messages? Saved backend revisions and pending request keys will be kept.")) return;
      if (project) chat.clear(project, revisions); else chat.resetDraft();
      setReload((value) => value + 1);
    },
    projects, projectCursor, listBusy, listError, project: visible ? project : null,
    revision: visible ? revision : null, revisions: visible ? revisions : [], revisionCursor,
    loadBusy, loadError: selection.error || loadError, prompt, setPrompt, notice, submitError,
    pending: visible ? pending : null, busy,
    canSubmit: !busy && !loadBusy && !loadError && !selection.error && !pending && visible,
    selectedProjectId: selection.projectId,
    navigate, submit, checkPending, abandonPending, loadMoreRevisions,
    loadMoreProjects: () => loadProjectPage(projectCursor), refreshProjects: () => loadProjectPage(),
    refreshSelection: () => setReload((value) => value + 1),
  };
}

export type WorkspaceState = ReturnType<typeof useWorkspace>;
