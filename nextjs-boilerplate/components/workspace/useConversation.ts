"use client";

import { useCallback, useRef, useState } from "react";
import { clearConversation, readConversation, restoreRevisionMessages, saveConversation, upsertChatEntry,
  type ChatEntry, type Conversation } from "@/lib/conversation";
import type { Project, RevisionSummary } from "@/lib/project-api";

const EMPTY: Conversation = { entries: [], trimmed: false, warning: "" };

// Keep the transcript above responsive panels; refs let overlapping progress updates append safely.
export function useConversation(userId: string | null) {
  const current = useRef({ userId, projectId: "", conversation: EMPTY });
  const [view, setView] = useState({ userId, projectId: "", conversation: EMPTY });

  // Commit one small immutable update; storage failure never breaks a generation request.
  const commit = useCallback((projectId: string, conversation: Conversation) => {
    const saved = userId && saveConversation(userId, projectId, conversation);
    const next = { userId, projectId, conversation: saved ? conversation : {
      ...conversation, warning: "Chat history could not be saved in this browser. Keep this tab open; backend revisions remain saved.",
    } };
    current.current = next; setView(next);
  }, [userId]);

  // Call only after Project Service has proved ownership; never expose a cache for a failed lookup.
  const restore = useCallback((project: Project, revisions: RevisionSummary[]) => {
    const cached = current.current.userId === userId && current.current.projectId === project.id ? current.current.conversation
      : userId ? readConversation(userId, project.id) : EMPTY;
    commit(project.id, restoreRevisionMessages(project, revisions, cached));
  }, [userId, commit]);

  // Unsaved chat stays account-scoped without creating a backend project for every greeting.
  const restoreDraft = useCallback(() => {
    const cached = current.current.userId === userId && current.current.projectId === "draft" ? current.current.conversation
      : userId ? readConversation(userId, "draft") : EMPTY;
    commit("draft", cached);
  }, [userId, commit]);

  // Move the real transcript with the first generated project instead of replacing it with a form.
  const adoptProject = useCallback((project: Project) => {
    const draft = current.current.userId === userId && current.current.projectId === "draft" ? current.current.conversation : EMPTY;
    commit(project.id, restoreRevisionMessages(project, [], draft));
    if (userId) clearConversation(userId, "draft");
  }, [userId, commit]);

  // Read the ref so the next request includes the last completed reply, not a stale React render.
  function entries(projectId: string) {
    return current.current.userId === userId && current.current.projectId === projectId ? current.current.conversation.entries : [];
  }

  // Starting over only clears this browser's unsaved conversation, never saved projects.
  function resetDraft() {
    if (userId) clearConversation(userId, "draft");
    commit("draft", EMPTY);
  }

  // The id belongs to one logical request, so repeated status reads update rather than duplicate it.
  const write = useCallback((projectId: string, entry: Omit<ChatEntry, "createdAt"> & { createdAt?: string }) => {
    const conversation = current.current.userId === userId && current.current.projectId === projectId ? current.current.conversation
      : userId ? readConversation(userId, projectId) : EMPTY;
    commit(projectId, upsertChatEntry(conversation, { ...entry, createdAt: entry.createdAt ?? new Date().toISOString() }));
  }, [userId, commit]);

  // A bounded activity trail preserves earlier steps instead of replacing one status label.
  const activity = useCallback((projectId: string, id: string, text: string,
    state: NonNullable<ChatEntry["state"]>, steps: string[] = []) => {
    const previous = current.current.userId === userId && current.current.projectId === projectId
      ? current.current.conversation.entries.find((entry) => entry.id === id) : undefined;
    const details = [...new Set([...(previous?.details ?? []), ...steps, text])].slice(-16);
    if (previous?.text === text && previous.state === state && JSON.stringify(previous.details) === JSON.stringify(details)) return;
    write(projectId, { id, role: "assistant", kind: "activity", text, state, details });
  }, [write, userId]);

  // Database messages replace cached message text; local build/Preview activity is only a display convenience.
  const restoreServer = useCallback((projectId: string, entries: ChatEntry[]) => {
    const cached = current.current.userId === userId && current.current.projectId === projectId ? current.current.conversation : EMPTY;
    const ids = new Set(entries.map((entry) => entry.id));
    let next = { ...cached, entries: cached.entries.filter((entry) => entry.kind === "result" ||
      (entry.kind === "activity" && (!entry.id.startsWith("chat:") || ids.has(entry.id)))) };
    for (const entry of entries) next = upsertChatEntry(next, entry);
    commit(projectId, next);
  }, [userId, commit]);

  // Clearing display history must not alter backend revisions or silently retry abandoned work.
  const clear = useCallback((project: Project, revisions: RevisionSummary[]) => {
    if (userId) clearConversation(userId, project.id);
    commit(project.id, restoreRevisionMessages(project, revisions, EMPTY));
  }, [userId, commit]);

  return { view, restore, restoreDraft, adoptProject, entries, resetDraft, write, activity, clear, restoreServer };
}
