"use client";

import { ArrowUp, MessageSquarePlus, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { sampleAssistantMessage } from "./workspace-data";

const recentChats = ["Developer portfolio", "Analytics dashboard", "Coffee shop website"];

export function ChatPanel() {
  const [prompt, setPrompt] = useState("");
  const [sentPrompts, setSentPrompts] = useState<string[]>([
    "Build a minimal developer portfolio with a dark theme.",
  ]);
  const [notice, setNotice] = useState("Backend disconnected — this is a local UI demo.");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanedPrompt = prompt.trim();

    if (!cleanedPrompt) {
      return;
    }

    // For now we keep prompts in React state. A real API call will replace
    // this line when the Project Service is connected.
    setSentPrompts((currentPrompts) => [...currentPrompts, cleanedPrompt]);
    setPrompt("");
    setNotice("Prompt saved locally. No AI request was sent.");
  }

  function startNewChat() {
    setSentPrompts([]);
    setPrompt("");
    setNotice("New local conversation started.");
  }

  return (
    <aside className="flex h-full min-h-[720px] flex-col border-b border-[#2b2b2e] bg-[#151516] xl:min-h-0 xl:border-b-0">
      {/* Recent chats stay simple until the backend provides real history. */}
      <section className="border-b border-[#2b2b2e] p-3">
        <button
          type="button"
          onClick={startNewChat}
          className="flex w-full items-center gap-2 rounded-md border border-[#38383c] bg-[#202022] px-3 py-2 text-xs hover:bg-[#29292c]"
        >
          <MessageSquarePlus size={14} />
          New conversation
        </button>

        <p className="mt-4 px-1 text-[10px] font-semibold tracking-widest text-[#747479] uppercase">
          Recent
        </p>

        <div className="mt-2 space-y-1">
          {recentChats.map((chat, index) => (
            <div
              key={chat}
              className={`truncate rounded px-2 py-1.5 text-xs ${
                index === 0 ? "bg-[#29292c] text-white" : "text-[#8d8d92]"
              }`}
            >
              {chat}
            </div>
          ))}
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-[#2b2b2e] px-4 py-3">
          <Sparkles size={14} className="text-[#b6f09c]" />
          <span className="text-xs font-medium">Agent</span>
          <span className="ml-auto rounded bg-[#242426] px-2 py-0.5 text-[10px] text-[#86868b]">
            UI demo
          </span>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {sentPrompts.length === 0 ? (
            <p className="py-12 text-center text-xs text-[#747479]">Start a conversation below.</p>
          ) : (
            sentPrompts.map((sentPrompt, index) => (
              <div key={`${sentPrompt}-${index}`}>
                <p className="mb-2 text-[10px] font-semibold tracking-wide text-[#747479] uppercase">
                  You
                </p>
                <p className="rounded-lg bg-[#252527] px-3 py-2.5 text-xs leading-5 text-[#dddddf]">
                  {sentPrompt}
                </p>
              </div>
            ))
          )}

          {sentPrompts.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-semibold tracking-wide text-[#747479] uppercase">
                AgentForge sample
              </p>
              {/* react-markdown safely turns AI markdown text into React elements. */}
              <div className="agent-markdown text-xs leading-5 text-[#c8c8cb]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{sampleAssistantMessage}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="border-t border-[#2b2b2e] p-3">
          <p className="mb-2 text-[10px] text-[#7c7c81]">{notice}</p>

          <div className="rounded-lg border border-[#3a3a3e] bg-[#1c1c1e] p-2 focus-within:border-[#68686e]">
            <label htmlFor="workspace-prompt" className="sr-only">
              Describe what you want to build
            </label>
            <textarea
              id="workspace-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask AgentForge to build..."
              rows={3}
              maxLength={1000}
              className="w-full resize-none bg-transparent px-1 text-xs outline-none placeholder:text-[#646469]"
            />

            <div className="mt-2 flex items-center justify-between">
              <span className="px-1 text-[10px] text-[#68686d]">Auto · {prompt.length}/1000</span>
              <button
                type="submit"
                disabled={!prompt.trim()}
                aria-label="Send prompt"
                className="grid size-7 place-items-center rounded-md bg-[#dddddf] text-[#111112] hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ArrowUp size={15} />
              </button>
            </div>
          </div>
        </form>
      </section>
    </aside>
  );
}
