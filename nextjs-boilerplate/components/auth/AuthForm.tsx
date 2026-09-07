"use client";

import { ArrowRight, Bot, Code2, Eye, EyeOff, PanelsTopLeft } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

type AuthFormProps = {
  mode: "login" | "register";
};

export function AuthForm({ mode }: AuthFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState("");

  const isRegister = mode === "register";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // This checkpoint builds only the UI. Credentials are deliberately not
    // stored or sent until the secure Auth Service connection is implemented.
    setNotice("UI check passed. Your credentials were not sent or stored.");
  }

  return (
    <main className="grid min-h-dvh bg-[#0f0f10] text-[#dedee0] lg:grid-cols-[minmax(0,1fr)_520px]">
      <section className="relative hidden overflow-hidden border-r border-[#2b2b2e] p-12 lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(182,240,156,0.08),transparent_35%),linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:auto,32px_32px,32px_32px]" />

        <div className="relative flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-[#dddddf] text-[#111112]">
            <Bot size={18} />
          </span>
          <span className="text-sm font-semibold text-white">AgentForge</span>
        </div>

        <div className="relative my-auto max-w-xl">
          <p className="text-xs font-medium tracking-[0.18em] text-[#b6f09c] uppercase">
            AI development workspace
          </p>
          <h1 className="mt-5 text-5xl font-semibold tracking-[-0.04em] text-white">
            Turn an idea into working frontend code.
          </h1>
          <p className="mt-5 max-w-lg text-sm leading-6 text-[#8f8f94]">
            Describe a page, review every generated file, inspect terminal output, and keep the
            complete build flow visible.
          </p>

          <div className="mt-10 grid max-w-lg grid-cols-2 gap-3">
            <div className="rounded-xl border border-[#2d2d30] bg-[#171718]/80 p-4">
              <Code2 size={17} className="text-[#79b8ff]" />
              <p className="mt-3 text-xs font-medium text-[#d5d5d7]">Review every file</p>
              <p className="mt-1 text-[11px] leading-5 text-[#76767b]">See code and changes together.</p>
            </div>
            <div className="rounded-xl border border-[#2d2d30] bg-[#171718]/80 p-4">
              <PanelsTopLeft size={17} className="text-[#b6f09c]" />
              <p className="mt-3 text-xs font-medium text-[#d5d5d7]">One focused workspace</p>
              <p className="mt-1 text-[11px] leading-5 text-[#76767b]">Chat, code, terminal, and tasks.</p>
            </div>
          </div>
        </div>

        <p className="relative text-[11px] text-[#5f5f64]">AgentForge Version Zero · UI prototype</p>
      </section>

      <section className="flex min-h-dvh items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-2 lg:hidden">
            <span className="grid size-8 place-items-center rounded-lg bg-[#dddddf] text-[#111112]">
              <Bot size={18} />
            </span>
            <span className="text-sm font-semibold text-white">AgentForge</span>
          </div>

          <p className="text-xs font-medium text-[#b6f09c]">
            {isRegister ? "START BUILDING" : "WELCOME BACK"}
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            {isRegister ? "Create your account" : "Sign in to AgentForge"}
          </h2>
          <p className="mt-2 text-sm text-[#77777c]">
            {isRegister
              ? "Set up your developer workspace in a few seconds."
              : "Continue to your AI development workspace."}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            {isRegister && (
              <div>
                <label htmlFor="name" className="mb-2 block text-xs text-[#b5b5b9]">
                  Name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  minLength={2}
                  required
                  placeholder="Tarun Gaur"
                  className="h-11 w-full rounded-lg border border-[#343438] bg-[#18181a] px-3 text-sm outline-none placeholder:text-[#55555a] focus:border-[#74747a]"
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="mb-2 block text-xs text-[#b5b5b9]">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                className="h-11 w-full rounded-lg border border-[#343438] bg-[#18181a] px-3 text-sm outline-none placeholder:text-[#55555a] focus:border-[#74747a]"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-xs text-[#b5b5b9]">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  minLength={8}
                  required
                  placeholder="Minimum 8 characters"
                  className="h-11 w-full rounded-lg border border-[#343438] bg-[#18181a] px-3 pr-11 text-sm outline-none placeholder:text-[#55555a] focus:border-[#74747a]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((currentValue) => !currentValue)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center text-[#6f6f74] hover:text-[#c7c7ca]"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#dddddf] text-sm font-medium text-[#111112] transition hover:bg-white"
            >
              {isRegister ? "Check registration form" : "Check sign-in form"}
              <ArrowRight size={15} />
            </button>
          </form>

          {notice && (
            <p role="status" className="mt-4 rounded-lg border border-[#34432f] bg-[#182016] px-3 py-2.5 text-xs leading-5 text-[#b6f09c]">
              {notice}
            </p>
          )}

          <p className="mt-6 text-center text-xs text-[#7b7b80]">
            {isRegister ? "Already have an account?" : "New to AgentForge?"}{" "}
            <Link
              href={isRegister ? "/login" : "/register"}
              className="font-medium text-[#d7d7da] hover:text-white"
            >
              {isRegister ? "Sign in" : "Create account"}
            </Link>
          </p>

          <div className="mt-8 border-t border-[#29292c] pt-6 text-center">
            <Link href="/workspace" className="text-xs text-[#77777c] hover:text-[#d0d0d3]">
              Open workspace UI demo →
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
