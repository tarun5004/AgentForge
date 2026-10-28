"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createProject, generateProject, repairProject, getGeneration, getProject, getRevision,
  listProjects, listRevisions, ProjectApiError,
  getRequirementBrief, generateConfirmedBrief,
  type Generation, type GenerationStatus, type FailedGenerationStatus, type Project, type Revision, type RevisionSummary,
} from "@/lib/project-api";
import {
  clearPendingGeneration, readPendingGeneration, savePendingGeneration, readFailedGeneration, saveFailedGeneration,
  type PendingGeneration,
} from "@/lib/pending-generation";
import { workspaceUrl, type WorkspaceSelection } from "@/lib/workspace-selection";
import type { SessionAccess } from "@/lib/session-request";
import { pollGeneration } from "@/lib/generation-poll";
import { generationActivity } from "@/lib/conversation";
import { useConversation } from "./useConversation";
import type { RequirementBrief } from "@/lib/requirement-brief";
import { conversationReport } from "@/lib/conversation-api";
import { createSavedChat, getSavedChat, linkChatProject, listSavedChats, savedChatEntries, streamSavedChat, type SavedChatSummary } from "@/lib/durable-chat";

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
function isTerminalGenerationError(error: unknown, repair = false): boolean {
  if (!(error instanceof ProjectApiError)) return false;
  if (error.status === 502) return !repair || ["AI_REPAIR_FAILED", "GENERATION_FAILED"].includes(error.code ?? "");
  return [400, 404, 413].includes(error.status) ||
    ["GENERATION_FAILED", "REVISION_CONFLICT", "IDEMPOTENCY_MISMATCH", "REPAIR_DISABLED", "REPAIR_UNAVAILABLE"].includes(error.code ?? "");
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
  const restoreServerChat = chat.restoreServer;
  const [savedChats, setSavedChats] = useState<SavedChatSummary[]>([]);
  const [chatListAccount, setChatListAccount] = useState<string | null>(null);
  const [chatListError, setChatListError] = useState("");
  const [chatCursor, setChatCursor] = useState<string | null>(null);
  const [olderChatCursor, setOlderChatCursor] = useState<number | null>(null);
  const threadRef = useRef<string | null>(null);
  const chatAbort = useRef<AbortController | null>(null);
  const [replyStreaming, setReplyStreaming] = useState(false);
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
  const [failedGeneration, setFailedGeneration] = useState<FailedGenerationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const selectionAbort = useRef<AbortController | null>(null);
  const listAbort = useRef<AbortController | null>(null);
  const submissionLock = useRef(false);
  const mounted = useRef(true);
  const account = useRef(userId);
  const pollAbort = useRef<AbortController | null>(null);
  const selectionKey = workspaceUrl(selection.projectId, selection.revisionId, selection.conversationId ?? null);
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

  // Conversation metadata is independent of projects, so a saved greeting is discoverable on another browser.
  const refreshChats = useCallback(async (before?: string) => {
    if (!session) return;
    const owner = userId;
    try {
      const page = await listSavedChats(session, undefined, before);
      if (!mounted.current || account.current !== owner) return;
      setSavedChats((current) => before ? [...current, ...page.conversations.filter((item) => !current.some((old) => old.id === item.id))] : page.conversations);
      setChatCursor(page.nextCursor); setChatListError(""); setChatListAccount(owner);
    } catch (error) { if (mounted.current && account.current === owner) setChatListError(reportError(error)); }
  }, [session, userId, reportError]);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    void listSavedChats(session, controller.signal).then((page) => {
      if (controller.signal.aborted) return;
      setSavedChats(page.conversations); setChatCursor(page.nextCursor); setChatListError(""); setChatListAccount(userId);
    }).catch((error) => { if (!controller.signal.aborted) setChatListError(reportError(error)); });
    return () => controller.abort();
  }, [session, userId, reportError]);

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
    return () => { mounted.current = false; controller.abort(); listAbort.current?.abort(); selectionAbort.current?.abort(); pollAbort.current?.abort(); chatAbort.current?.abort(); };
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
        const savedChat = selection.conversationId ? await getSavedChat(selection.conversationId, session!, controller.signal) : null;
        if (controller.signal.aborted || !mounted.current) return;
        if (savedChat?.projectId && !selection.projectId) {
          router.replace(workspaceUrl(savedChat.projectId, null, savedChat.id), { scroll: false });
          return;
        }
        if (savedChat && savedChat.projectId !== selection.projectId) throw new Error("This conversation belongs to a different project.");
        threadRef.current = savedChat?.id ?? null;
        setOlderChatCursor(savedChat?.nextBefore ?? null);
        if (!selection.projectId) {
          setProject(null); setRevision(null); setRevisions([]); setRevisionCursor(null);
          setLoadedKey(selectionKey); setPending(null); setFailedGeneration(null);
          restoreDraft();
          if (savedChat) restoreServerChat("draft", savedChatEntries(savedChat));
          return;
        }
        const [savedProject, history, selected] = await Promise.all([
          getProject(selection.projectId, session!, controller.signal),
          listRevisions(selection.projectId, session!, null, controller.signal),
          selection.revisionId ? getRevision(selection.projectId, selection.revisionId, session!, controller.signal) : Promise.resolve(null),
        ]);
        const snapshot = selected ?? (savedProject.latestRevision
          ? await getRevision(savedProject.id, savedProject.latestRevision.id, session!, controller.signal) : null);
        const failedId = readFailedGeneration(userId!, savedProject.id);
        let failedStatus: FailedGenerationStatus | null = null;
        if (failedId) {
          try {
            const status = await getGeneration(savedProject.id, failedId, session!, controller.signal);
            if (status.status === "failed") failedStatus = status;
          } catch (error) { if (error instanceof ProjectApiError && error.status === 401) throw error; }
        }
        let savedBrief: RequirementBrief | null = null;

        // Requirements remain part of the conversation even after its first revision is published.
        if (savedProject) {
          try { savedBrief = await getRequirementBrief(savedProject.id, session!, controller.signal); }
          catch (error) { if (!controller.signal.aborted && error instanceof ProjectApiError && error.status === 401) throw error; }
        }
        if (controller.signal.aborted || !mounted.current) return;
        setProject(savedProject); setRevision(snapshot); setRevisions(history.revisions); setRevisionCursor(history.nextCursor);
        setLoadedKey(selectionKey);
        setFailedGeneration(failedStatus);
        restoreChat(savedProject, history.revisions);
        if (savedChat) restoreServerChat(savedProject.id, savedChatEntries(savedChat));
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
  }, [session, userId, busy, selection.projectId, selection.revisionId, selection.conversationId, selection.error, selectionKey, reload, reportError, restoreChat, restoreDraft, restoreServerChat, writeChat, router]);

  // Invalidate old GETs immediately, before route props arrive from Next navigation.
  function navigate(projectId: string | null, revisionId: string | null = null, conversationId = projectId && projectId === project?.id ? threadRef.current : null) {
    if (submissionLock.current) return;
    selectionAbort.current?.abort();
    setLoadedKey(""); setLoadError(""); setSubmitError(""); setPending(null); setFailedGeneration(null); setPrompt("");
    if (!projectId && !conversationId) chat.resetDraft();
    setNotice(projectId ? "Loading saved project..." : "Ask a question or describe what to build.");
    router.replace(workspaceUrl(projectId, revisionId, conversationId), { scroll: false });
    // Same-URL selection is a genuine reload, not a no-op navigation.
    setReload((value) => value + 1);
  }

  // One model decides how to help; only a build response enters the existing generation workflow.
  async function sendMessage() {
    const text = prompt.trim();
    if (!session || !userId || !text || text.length > 1000 || submissionLock.current || !visible || loadBusy || loadError || pending) return;
    const threadId = project?.id ?? "draft";
    const requestId = crypto.randomUUID();
    const allowedUrls = new Set([window.location.pathname + window.location.search,
      workspaceUrl(project?.id ?? null, revision?.id ?? null, threadRef.current)]);
    // Browser Back/Forward is still available while request buttons are locked.
    const stillSelected = () => mounted.current && account.current === userId && allowedUrls.has(window.location.pathname + window.location.search);
    submissionLock.current = true; setBusy(true); setSubmitError("");
    selectionAbort.current?.abort();
    chat.write(threadId, { id: `chat:${requestId}:user`, role: "user", kind: "message", text });
    chat.activity(threadId, `chat:${requestId}`, "Waiting for the AI response.", "working");
    let buildPrompt: string | undefined;
    try {
      let id = threadRef.current;
      if (!id) {
        const created = await createSavedChat(session);
        if (!stillSelected()) return;
        id = created.id; threadRef.current = id;
        if (project) await linkChatProject(id, project.id, session);
        const url = workspaceUrl(project?.id ?? null, revision?.id ?? null, id);
        allowedUrls.add(url); setLoadedKey(url); router.replace(url, { scroll: false });
      }
      const controller = new AbortController();
      chatAbort.current = controller;
      setReplyStreaming(true);
      const response = await streamSavedChat(id, {
        key: requestId, message: text, ...(project ? { projectId: project.id } : {}),
        ...(revision ? { baseRevisionId: revision.id } : {}),
      }, session, (message) => {
        if (stillSelected()) chat.write(threadId, { id: `chat:${requestId}:assistant`, role: "assistant", kind: "message", text: message, state: "working" });
      }, AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]));
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
      chat.write(threadId, { id: `chat:${requestId}:assistant`, role: "assistant", kind: "message", text: "Reply interrupted; partial text was not accepted. Reload saved chat to check the outcome.", state: "unknown" });
      setNotice("Message kept below. Reload saved chat before a deliberate new attempt; no automatic retry.");
    } finally {
      submissionLock.current = false;
      chatAbort.current = null;
      if (mounted.current) { setBusy(false); setReplyStreaming(false); }
      void refreshChats();
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
    setLoadedKey(workspaceUrl(savedProject.id, result.revisionId, threadRef.current));
    setPrompt(""); setSubmitError(""); setPending(null); setFailedGeneration(null);
    if (userId) saveFailedGeneration(userId, savedProject.id, null);
    setNotice(`Revision v${result.revisionVersion} committed. ${result.files.length} files saved.`);
    if (attemptKey) chat.activity(savedProject.id, `generation:${attemptKey}`,
      `Revision v${result.revisionVersion} is ready.`, "done", generationActivity(result));
    chat.write(savedProject.id, { id: `revision:${result.revisionId}`, role: "assistant", kind: "result",
      text: result.summary, state: "done", revisionId: result.revisionId,
      details: revisionDetails(snapshotFromGeneration(result)),
    });
    router.replace(workspaceUrl(savedProject.id, result.revisionId, threadRef.current), { scroll: false });
    void loadProjectPage();
  }

  // Freeze project/base/key for the whole attempt; no UI change may mutate an in-flight request.
  async function submit(retry = false, generationPrompt?: string, repairOf?: string) {
    if (!session || !userId || submissionLock.current || (!retry && (loadBusy || selection.error))) return;
    if (!retry && generationPrompt === undefined && !repairOf) { await sendMessage(); return; }
    const text = (generationPrompt ?? prompt).trim();
    if (!retry && (pending || !visible || loadError)) return;
    if (!retry && !repairOf && (text.length < 10 || text.length > 1000)) return;
    if (repairOf && (!project || failedGeneration?.id !== repairOf || !failedGeneration.repairAvailable)) return;
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
          if (threadRef.current) await linkChatProject(threadRef.current, savedProject.id, session);
          if (!stillSelected()) return;
          const url = workspaceUrl(savedProject.id, null, threadRef.current);
          setLoadedKey(url);
          allowedUrls.add(url);
          router.replace(url, { scroll: false });
          void loadProjectPage();
        }
        intent = { projectId: savedProject.id, key: crypto.randomUUID(),
          body: repairOf ? {} : { prompt: text, ...(revision ? { baseRevisionId: revision.id } : {}) },
          ...(repairOf ? { repairOf } : {}),
        };
        setFailedGeneration(null);
        if (!repairOf) saveFailedGeneration(userId, savedProject.id, null);
        savePendingGeneration(userId, intent); setPending(intent);
      }
      if (!savedProject || savedProject.id !== intent.projectId) throw new Error("Reload this project before retrying.");
      if (retry) chat.write(savedProject.id, { id: `generation:${intent.key}:request`, role: "user", kind: "message",
        text: intent.repairOf ? "Retry the same reserved repair." : intent.body.prompt ?? "Generate code from the confirmed brief.",
        details: intent.body.baseRevisionId ? [`Selected base: ${intent.body.baseRevisionId}`] : undefined,
      });
      chat.activity(savedProject.id, `generation:${intent.key}`, intent.repairOf ? "One repair requested. Waiting for validated output and a fresh build." : "Generation requested. Waiting for validated model output.", "working");
      let result: GenerationStatus;
      if (intent.repairOf) {
        setNotice("Repairing the failed candidate once; saved revisions stay unchanged until a fresh build passes.");
        result = await repairProject(intent.projectId, intent.repairOf, session, intent.key);
      } else {
        setNotice(intent.body.baseRevisionId ? "Generating changes against the frozen selected revision..." : "Project saved. Generating its first revision...");
        result = intent.briefId
          ? await generateConfirmedBrief(intent.projectId, intent.briefId, session, intent.key)
          : await generateProject(intent.projectId, session, intent.key, intent.body);
      }
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
      if (!stillSelected()) return;
      if (result.status === "failed") {
        saveFailedGeneration(userId, intent.projectId, result.id); setFailedGeneration(result);
        throw new ProjectApiError("Generation or build verification failed. Saved files remain unchanged.", 502, "GENERATION_FAILED", result.id);
      }
      clearPendingGeneration(userId, intent.projectId);
      acceptGeneration(result, savedProject, intent.key);
    } catch (error) {
      if (!stillSelected()) return;
      if (intent) {
        if (error instanceof ProjectApiError && error.generationId) intent = { ...intent, generationId: error.generationId };
        const terminal = isTerminalGenerationError(error, !!intent.repairOf);
        chat.activity(intent.projectId, `generation:${intent.key}`, errorMessage(error), terminal ? "error" : "unknown");
        if (terminal) {
          clearPendingGeneration(userId, intent.projectId); setPending(null);
          if (error instanceof ProjectApiError && error.generationId) saveFailedGeneration(userId, intent.projectId, error.generationId);
          setNotice(intent.repairOf ? "The repair request ended. Saved revisions remain unchanged." : "Saved files are unchanged. You can revise the message and send again.");
        }
        else { savePendingGeneration(userId, intent); setPending(intent); setNotice("Completion is not confirmed. Check status or retry the same attempt."); }
        const recovery = terminal
          ? (intent.repairOf ? "No automatic second repair will run." : "Saved files are unchanged; a new submission uses a new key.")
          : "Outcome not confirmed. Check status or retry this same attempt.";
        setSubmitError(`${reportError(error)} ${recovery}`);
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
        if (userId) saveFailedGeneration(userId, pending.projectId, result.id);
        setFailedGeneration(result);
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

  // Page older server turns without another model call; merge by stable request IDs.
  async function loadOlderChat() {
    if (!session || !threadRef.current || olderChatCursor === null || busy || loadBusy) return;
    const id = threadRef.current;
    const owner = userId;
    setLoadBusy(true);
    try {
      const page = await getSavedChat(id, session, undefined, olderChatCursor);
      if (threadRef.current !== id || account.current !== owner || !mounted.current) return;
      for (const entry of savedChatEntries(page)) chat.write(project?.id ?? "draft", entry);
      setOlderChatCursor(page.nextBefore);
    } catch (error) { if (threadRef.current === id && account.current === owner && mounted.current) setSubmitError(reportError(error)); }
    finally { if (threadRef.current === id && account.current === owner && mounted.current) setLoadBusy(false); }
  }

  return {
    conversation: visible && chat.view.userId === userId && chat.view.projectId === (project?.id ?? "draft") ? chat.view.conversation : null,
    recordPreview: chat.activity,
    savedChats: chatListAccount === userId ? savedChats : [], chatListError, chatCursor, olderChatCursor, refreshChats,
    loadMoreChats: () => refreshChats(chatCursor ?? undefined), loadOlderChat,
    stopReply: () => chatAbort.current?.abort(),
    replyStreaming,
    // Clearing UI history is separate from deleting saved work or abandoning a paid request.
    clearLocalChat: () => {
      if (busy || !window.confirm("Clear this browser's chat messages? Saved backend revisions and pending request keys will be kept.")) return;
      if (project) chat.clear(project, revisions); else chat.resetDraft();
      setReload((value) => value + 1);
    },
    projects, projectCursor, listBusy, listError, project: visible ? project : null,
    revision: visible ? revision : null, revisions: visible ? revisions : [], revisionCursor,
    loadBusy, loadError: selection.error || loadError, prompt, setPrompt, notice, submitError,
    pending: visible ? pending : null, failedGeneration: visible ? failedGeneration : null, busy,
    canSubmit: !busy && !loadBusy && !loadError && !selection.error && !pending && visible,
    selectedProjectId: selection.projectId,
    navigate, submit, checkPending, abandonPending, loadMoreRevisions,
    repairOnce: () => failedGeneration?.repairAvailable ? submit(false, undefined, failedGeneration.id) : Promise.resolve(),
    loadMoreProjects: () => loadProjectPage(projectCursor), refreshProjects: () => loadProjectPage(),
    refreshSelection: () => setReload((value) => value + 1),
  };
}

export type WorkspaceState = ReturnType<typeof useWorkspace>;
