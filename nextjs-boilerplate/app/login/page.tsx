import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = {
  title: "Sign in — AgentForge",
  description: "Sign in to your AgentForge workspace.",
};

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
