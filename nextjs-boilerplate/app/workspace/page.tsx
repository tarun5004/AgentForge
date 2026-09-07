import type { Metadata } from "next";

import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

export const metadata: Metadata = {
  title: "Workspace — AgentForge",
  description: "Review generated code and project changes in AgentForge.",
};

export default function WorkspacePage() {
  return <WorkspaceShell />;
}
