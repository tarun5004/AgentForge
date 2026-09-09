"use client";

import { Bot } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "./AuthProvider";

export function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, isCheckingSession } = useAuth();

  useEffect(() => {
    if (!isCheckingSession && !user) {
      router.replace("/login");
    }
  }, [isCheckingSession, router, user]);

  if (isCheckingSession || !user) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#0f0f10] text-[#dedee0]">
        <div role="status" className="flex items-center gap-3 text-sm text-[#8f8f94]">
          <Bot size={18} className="text-[#b6f09c]" />
          {isCheckingSession ? "Checking your session..." : "Redirecting to sign in..."}
        </div>
      </main>
    );
  }

  return children;
}
