export type WorkspaceSelection = { projectId: string | null; revisionId: string | null; error: string };

// A revision cannot be opened without its project; arrays represent duplicate query values.
export function parseWorkspaceSelection(query: Record<string, string | string[] | undefined>): WorkspaceSelection {
  const { project, revision } = query;
  const validId = (value: unknown): value is string => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
  if ((project !== undefined && !validId(project)) || (revision !== undefined && !validId(revision)) || (revision && !project)) {
    return { projectId: null, revisionId: null, error: "Invalid workspace link. Choose a saved project or start a new conversation." };
  }
  return { projectId: typeof project === "string" ? project.toLowerCase() : null, revisionId: typeof revision === "string" ? revision.toLowerCase() : null, error: "" };
}

// Only IDs build our own fixed route; never navigate to a model/user-supplied URL.
export function workspaceUrl(projectId: string | null, revisionId: string | null = null): string {
  if (!projectId) return "/workspace";
  const query = new URLSearchParams({ project: projectId });
  if (revisionId) query.set("revision", revisionId);
  return `/workspace?${query}`;
}
