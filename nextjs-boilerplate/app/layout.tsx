import type { Metadata } from "next";

import { AuthProvider } from "@/components/auth/AuthProvider";
import { LocalDemoNotice } from "@/components/LocalDemoNotice";

import "./globals.css";

export const metadata: Metadata = {
  title: "AgentForge — AI Workspace",
  description: "Generate and review frontend code in an AI development workspace.",
};

// Only the isolated launcher enables this label; the flag itself does not disable a provider.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        {process.env.AGENTFORGE_LOCAL_DEMO === "1" ? <LocalDemoNotice /> : null}
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
