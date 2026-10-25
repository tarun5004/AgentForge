"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createProject, generateProject, getGeneration, getProject, getRevision,
  listProjects, listRevisions, ProjectApiError,
  getRequirementBrief, assessRequirementBrief, updateRequirementBrief, generateConfirmedBrief,
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
import {
  briefAnswerDrafts, isBriefAnswers, readPendingBrief, savePendingBrief, clearPendingBrief,
  type BriefAnswer, type PendingBrief, type RequirementBrief,
} from "@/lib/requirement-brief";

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
  const [brief, setBrief] = useState<RequirementBrief | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<BriefAnswer[]>([]);
  const [briefIntent, setBriefIntent] = useState<PendingBrief | null>(null);
  const [briefError, setBriefError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const selectionAbort = useRef<AbortController | null>(null);
  const listAbort = useRef<AbortController | null>(null);
  const submissionLock = useRef(false);
  const mounted = useRef(true);
  const pollAbort = useRef<AbortController | null>(null);
  const answerSnapshot = useRef("");
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
          setBrief(null); setAnswerDrafts([]); setBriefIntent(null); setBriefError("");
          answerSnapshot.current = "";
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
        let briefReadError = "";
        // Requirements remain part of the conversation even after its first revision is published.
        if (savedProject) {
          try { savedBrief = await getRequirementBrief(savedProject.id, session!, controller.signal); }
          catch (error) { if (!controller.signal.aborted) briefReadError = reportError(error); }
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
        setBrief(savedBrief); setBriefError(briefReadError);
        const snapshotKey = `${savedProject.id}:${savedBrief?.id ?? "empty"}`;
        if (answerSnapshot.current !== snapshotKey) {
          setAnswerDrafts(briefAnswerDrafts(savedBrief));
          answerSnapshot.current = snapshotKey;
        }
        // Disabled sessionStorage must not erase a key still held in this mounted shell.
        setBriefIntent((current) => current?.projectId === savedProject.id ? current : readPendingBrief(userId!, savedProject.id));
        if (restoredIntent) setNotice("Saved attempt restored. Check status or retry the same attempt; no new request key is needed.");
      } catch (error) {
        if (!controller.signal.aborted && mounted.current) setLoadError(reportError(error));
      } finally {
        if (!controller.signal.aborted && mounted.current) setLoadBusy(false);
      }
    }
    void loadSelection();
    return () => controller.abort();
  }, [session, userId, busy, selection.projectId, selection.revisionId, selection.error, selectionKey, reload, reportError, restoreChat, writeChat]);

  // Invalidate old GETs immediately, before route props arrive from Next navigation.
  function navigate(projectId: string | null, revisionId: string | null = null) {
    if (submissionLock.current) return;
    selectionAbort.current?.abort();
    setLoadedKey(""); setLoadError(""); setSubmitError(""); setPending(null); setPrompt("");
    setBrief(null); setAnswerDrafts([]); setBriefIntent(null); setBriefError("");
    answerSnapshot.current = "";
    setNotice(projectId ? "Loading saved project..." : "Your next prompt creates a new project.");
    router.replace(workspaceUrl(projectId, revisionId), { scroll: false });
    // Same-URL selection is a genuine reload, not a no-op navigation.
    setReload((value) => value + 1);
  }

  // Keep answer edits above responsive panels so resizing does not reset the user's facts.
  function editBriefAnswer(index: number, answer: string) {
    if (busy || briefIntent || pending) return;
    setAnswerDrafts((current) => current.map((item, position) => position === index ? { ...item, answer } : item));
  }

  // All mutations share the generation lock: selection/sign-out cannot change operation identity.
  async function actOnBrief(action: "assess" | "confirm" | "abandon" | "reload", retry = false) {
    if (!session || !userId || submissionLock.current || !visible || loadBusy || selection.error || loadError || pending) return;
    if (action === "abandon" && !window.confirm("Abandon this pending assessment? This cannot cancel/refund a provider call. A new attempt may spend again.")) return;
    if (action === "confirm" && (briefIntent || !brief || brief.assessment?.status !== "ready" || JSON.stringify(answerDrafts) !== JSON.stringify(brief.answers))) return;
    if (action === "assess" && !retry && (briefError || briefIntent || brief?.status === "pending" || !isBriefAnswers(answerDrafts))) return;
    if (retry && !briefIntent) return;
    const text = prompt.trim();
    if (!project && (action !== "assess" || text.length < 10 || text.length > 1000)) return;
    submissionLock.current = true; setBusy(true); setBriefError(""); setSubmitError("");
    selectionAbort.current?.abort();
    let savedProject = project;
    let intent = retry ? briefIntent : null;
    try {
      if (!savedProject) {
        savedProject = await createProject(text, session);
        if (!mounted.current) return;
        setProject(savedProject); setRevision(null); setRevisions([]); setPrompt("");
        chat.restore(savedProject, []);
        setLoadedKey(workspaceUrl(savedProject.id));
        router.replace(workspaceUrl(savedProject.id), { scroll: false });
        void loadProjectPage();
      }
      let result: RequirementBrief | null;
      if (action === "reload") {
        result = await getRequirementBrief(savedProject.id, session, AbortSignal.timeout(10_000));
      } else if (action === "assess") {
        if (!intent) {
          intent = { projectId: savedProject.id, key: crypto.randomUUID(), body: {
            expectedVersion: brief?.version ?? 0,
            answers: answerDrafts.map((item) => ({ question: item.question, answer: item.answer.trim() })),
          } };
          savePendingBrief(userId, intent); setBriefIntent(intent);
        }
        setNotice("Assessing requirements. Code generation has not started.");
        intent.body.answers.forEach((answer, index) => chat.write(savedProject!.id, {
          id: `brief:${intent!.key}:answer:${index}`, role: "user", kind: "message",
          text: `${answer.question}\n${answer.answer}`,
        }));
        chat.activity(savedProject.id, `brief:${intent.key}`, "Requirements assessment requested.", "working");
        result = await assessRequirementBrief(intent.projectId, session, intent.key, intent.body);
        if (result.status !== "pending") {
          clearPendingBrief(userId, savedProject.id); setBriefIntent(null);
        }
      } else {
        if (!brief) throw new Error("Reload the saved brief first.");
        result = await updateRequirementBrief(savedProject.id, brief.id, action, session);
        if (action === "abandon") {
          clearPendingBrief(userId, savedProject.id); setBriefIntent(null);
        }
      }
      if (!mounted.current) return;
      if (result?.assessment) chat.write(savedProject.id, {
        id: `requirements:${result.id}`, role: "assistant", kind: "requirements",
        text: result.assessment.message, details: [result.assessment.brief, ...result.assessment.questions], state: "done",
      });
      if (intent) chat.activity(savedProject.id, `brief:${intent.key}`, result?.status === "completed"
        ? "Requirements assessment completed." : "Assessment not confirmed. Reload before continuing.",
      result?.status === "completed" ? "done" : "unknown");
      if (action === "confirm" && result) chat.activity(savedProject.id, `confirmation:${result.id}`,
        "Brief confirmed by you. Code generation has not started.", "done");
      if (action === "abandon" && result) chat.activity(savedProject.id, `abandon-brief:${result.id}`,
        "Assessment abandoned explicitly. This does not refund a provider call.", "done");
      setBrief(result); setAnswerDrafts(briefAnswerDrafts(result));
      answerSnapshot.current = `${savedProject.id}:${result?.id ?? "empty"}`;
      setNotice(result?.confirmedAt ? "Brief confirmed. Choose Generate code when ready." : "Requirements saved. Review the next action below.");
    } catch (error) {
      if (!mounted.current) return;
      // Only confirmed admission rejections discard local identity. 502/503/transport remain replayable.
      if (intent && error instanceof ProjectApiError && ([400, 404, 413].includes(error.status) ||
          ["BRIEF_VERSION_CONFLICT", "IDEMPOTENCY_MISMATCH", "INVALID_BRIEF_ANSWERS"].includes(error.code ?? ""))) {
        clearPendingBrief(userId, intent.projectId); setBriefIntent(null);
      }
      const message = reportError(error);
      if (savedProject) chat.activity(savedProject.id, `brief:${intent?.key ?? "control"}`, message, "unknown");
      setBriefError(message); setSubmitError(message);
      if (!savedProject) void loadProjectPage();
    } finally {
      submissionLock.current = false;
      // The selection loader preserves draft answers while their saved snapshot is unchanged.
      if (mounted.current) setBusy(false);
    }
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
  async function submit(retry = false, fromBrief = false) {
    if (!session || !userId || submissionLock.current || (!retry && (loadBusy || selection.error))) return;
    if (!retry && !fromBrief && !revision) { await actOnBrief("assess"); return; }
    const text = prompt.trim();
    if (!retry && (pending || !visible || loadError)) return;
    if (!retry && !fromBrief && (text.length < 10 || text.length > 1000)) return;
    if (fromBrief && (!project || !brief?.confirmedAt || briefIntent || briefError || brief.status !== "completed" ||
      brief.assessment?.status !== "ready" || JSON.stringify(answerDrafts) !== JSON.stringify(brief.answers))) return;
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
        intent = { projectId: savedProject.id, key: crypto.randomUUID(),
          body: fromBrief ? {} : { prompt: text, ...(revision ? { baseRevisionId: revision.id } : {}) },
          ...(fromBrief && brief ? { briefId: brief.id } : {}),
        };
        savePendingGeneration(userId, intent); setPending(intent);
      }
      if (!savedProject || savedProject.id !== intent.projectId) throw new Error("Reload this project before retrying.");
      chat.write(savedProject.id, { id: `generation:${intent.key}:request`, role: "user", kind: "message",
        text: intent.body.prompt ?? "Generate code from the confirmed brief.",
        details: intent.body.baseRevisionId ? [`Selected base: ${intent.body.baseRevisionId}`] : undefined,
      });
      chat.activity(savedProject.id, `generation:${intent.key}`, "Generation requested. Waiting for validated model output.", "working");
      setNotice(intent.body.baseRevisionId ? "Generating changes against the frozen selected revision..." : "Project saved. Generating its first revision...");
      let result: GenerationStatus = intent.briefId
        ? await generateConfirmedBrief(intent.projectId, intent.briefId, session, intent.key)
        : await generateProject(intent.projectId, session, intent.key, intent.body);
      if (!mounted.current) return;
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
      clearPendingGeneration(userId, intent.projectId);
      acceptGeneration(result, savedProject, intent.key);
    } catch (error) {
      if (!mounted.current) return;
      if (intent) {
        if (error instanceof ProjectApiError && error.generationId) intent = { ...intent, generationId: error.generationId };
        const terminal = isTerminalGenerationError(error);
        chat.activity(intent.projectId, `generation:${intent.key}`, errorMessage(error), terminal ? "error" : "unknown");
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
    conversation: visible && chat.view.userId === userId && chat.view.projectId === project?.id ? chat.view.conversation : null,
    recordPreview: chat.activity,
    // Clearing UI history is separate from deleting saved work or abandoning a paid request.
    clearLocalChat: () => {
      if (!project || busy || !window.confirm("Clear this browser's chat messages? Saved backend revisions and pending request keys will be kept.")) return;
      chat.clear(project, revisions); setReload((value) => value + 1);
    },
    projects, projectCursor, listBusy, listError, project: visible ? project : null,
    revision: visible ? revision : null, revisions: visible ? revisions : [], revisionCursor,
    loadBusy, loadError: selection.error || loadError, prompt, setPrompt, notice, submitError,
    pending: visible ? pending : null, busy,
    brief: visible ? brief : null, answerDrafts, briefIntent: visible ? briefIntent : null, briefError: visible ? briefError : "",
    briefDirty: !!brief && JSON.stringify(answerDrafts) !== JSON.stringify(brief.answers),
    actOnBrief, editBriefAnswer, generateBrief: () => submit(false, true),
    canSubmit: !busy && !loadBusy && !loadError && !selection.error && !pending && !briefIntent && visible,
    selectedProjectId: selection.projectId,
    navigate, submit, checkPending, abandonPending, loadMoreRevisions,
    loadMoreProjects: () => loadProjectPage(projectCursor), refreshProjects: () => loadProjectPage(),
    refreshSelection: () => setReload((value) => value + 1),
  };
}

export type WorkspaceState = ReturnType<typeof useWorkspace>;
