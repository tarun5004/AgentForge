import type { Metadata } from "next";

import { RequireAuth } from "@/components/auth/RequireAuth";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { parseWorkspaceSelection } from "@/lib/workspace-selection";

export const metadata: Metadata = {
  title: "Workspace — AgentForge",
  description: "Review generated code and project changes in AgentForge.",
};

// Next's request-time params are asynchronous; only validated IDs reach the client shell.
export default async function WorkspacePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const selection = parseWorkspaceSelection(await searchParams);
  return (
    <RequireAuth>
      <WorkspaceShell selection={selection} />
    </RequireAuth>
  );
}
