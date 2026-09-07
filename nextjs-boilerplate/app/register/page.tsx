import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = {
  title: "Create account — AgentForge",
  description: "Create your AgentForge account.",
};

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
