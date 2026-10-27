export type WorkspaceSelection = { projectId: string | null; revisionId: string | null; conversationId?: string | null; error: string };

// A revision cannot be opened without its project; arrays represent duplicate query values.
export function parseWorkspaceSelection(query: Record<string, string | string[] | undefined>): WorkspaceSelection {
  const { project, revision, conversation } = query;
  const validId = (value: unknown): value is string => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
  if ((project !== undefined && !validId(project)) || (revision !== undefined && !validId(revision)) || (conversation !== undefined && !validId(conversation)) || (revision && !project)) {
    return { projectId: null, revisionId: null, error: "Invalid workspace link. Choose a saved project or start a new conversation." };
  }
  return { projectId: typeof project === "string" ? project.toLowerCase() : null, revisionId: typeof revision === "string" ? revision.toLowerCase() : null,
    ...(typeof conversation === "string" ? { conversationId: conversation.toLowerCase() } : {}), error: "" };
}

// Only IDs build our own fixed route; never navigate to a model/user-supplied URL.
export function workspaceUrl(projectId: string | null, revisionId: string | null = null, conversationId: string | null = null): string {
  const query = new URLSearchParams();
  if (projectId) query.set("project", projectId);
  if (projectId && revisionId) query.set("revision", revisionId);
  if (conversationId) query.set("conversation", conversationId);
  return query.size ? `/workspace?${query}` : "/workspace";
}
