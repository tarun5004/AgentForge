"use client";

import { ArrowUp, MessageSquarePlus, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { createProject, generateProject } from "@/lib/project-api";

const recentChats = ["Developer portfolio", "Analytics dashboard", "Coffee shop website"];

type CreatedProjectMessage = {
  id: string;
  prompt: string;
  projectName: string;
  status: "generating" | "ready" | "failed";
  summary?: string;
  fileCount?: number;
  totalTokens?: number;
  model?: string;
};

export function ChatPanel() {
  const { accessToken } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [createdProjects, setCreatedProjects] = useState<CreatedProjectMessage[]>([]);
  const [notice, setNotice] = useState(
    "Describe a frontend page. AgentForge will save the project, then generate its files.",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanedPrompt = prompt.trim();

    if (!cleanedPrompt || !accessToken) {
      if (!accessToken) {
        setErrorMessage("Your session is not ready. Please sign in again.");
      }
      return;
    }

    setIsCreatingProject(true);
    setErrorMessage("");

    try {
      const project = await createProject(cleanedPrompt, accessToken);
      setCreatedProjects((currentProjects) => [
        ...currentProjects,
        {
          id: project.id,
          prompt: cleanedPrompt,
          projectName: project.name,
          status: "generating",
        },
      ]);
      setPrompt("");
      setNotice(`Project "${project.name}" saved. AI is generating the files...`);

      try {
        const generation = await generateProject(project.id, accessToken);

        setCreatedProjects((currentProjects) =>
          currentProjects.map((currentProject) =>
            currentProject.id === project.id
              ? {
                  ...currentProject,
                  status: "ready",
                  summary: generation.summary,
                  fileCount: generation.files.length,
                  totalTokens: generation.usage.totalTokens,
                  model: generation.model,
                }
              : currentProject,
          ),
        );
        setNotice(`Generation complete: ${generation.files.length} files saved as revision 1.`);
      } catch (generationError) {
        setCreatedProjects((currentProjects) =>
          currentProjects.map((currentProject) =>
            currentProject.id === project.id
              ? { ...currentProject, status: "failed" }
              : currentProject,
          ),
        );
        setErrorMessage(
          generationError instanceof Error
            ? generationError.message
            : "Could not generate the project files.",
        );
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not create the project.",
      );
    } finally {
      setIsCreatingProject(false);
    }
  }

  function startNewChat() {
    setCreatedProjects([]);
    setPrompt("");
    setErrorMessage("");
    setNotice("New conversation started. Your next prompt will create a draft project.");
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
            Project API
          </span>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {createdProjects.length === 0 ? (
            <p className="py-12 text-center text-xs text-[#747479]">Start a conversation below.</p>
          ) : (
            createdProjects.map((project) => (
              <div key={project.id} className="space-y-4">
                <p className="mb-2 text-[10px] font-semibold tracking-wide text-[#747479] uppercase">
                  You
                </p>
                <p className="rounded-lg bg-[#252527] px-3 py-2.5 text-xs leading-5 text-[#dddddf]">
                  {project.prompt}
                </p>

                <div>
                  <p className="mb-2 text-[10px] font-semibold tracking-wide text-[#747479] uppercase">
                    AgentForge
                  </p>
                  <div
                    className={`rounded-lg border px-3 py-2.5 text-xs leading-5 ${
                      project.status === "failed"
                        ? "border-[#5a3030] bg-[#241616] text-[#ffaaaa]"
                        : "border-[#34432f] bg-[#182016] text-[#b6f09c]"
                    }`}
                  >
                    {project.status === "generating" && (
                      <p>Project saved. Generating frontend files...</p>
                    )}
                    {project.status === "failed" && (
                      <p>Project was saved, but code generation failed.</p>
                    )}
                    {project.status === "ready" && (
                      <div className="space-y-1">
                        <p>{project.summary}</p>
                        <p className="text-[10px] text-[#8fa781]">
                          {project.fileCount} files · {project.totalTokens} tokens · {project.model}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <form onSubmit={handleSubmit} className="border-t border-[#2b2b2e] p-3">
          {errorMessage ? (
            <p role="alert" className="mb-2 text-[10px] text-[#ffaaaa]">
              {errorMessage}
            </p>
          ) : (
            <p role="status" className="mb-2 text-[10px] text-[#7c7c81]">
              {notice}
            </p>
          )}

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
              minLength={10}
              disabled={isCreatingProject}
              className="w-full resize-none bg-transparent px-1 text-xs outline-none placeholder:text-[#646469]"
            />

            <div className="mt-2 flex items-center justify-between">
              <span className="px-1 text-[10px] text-[#68686d]">Auto · {prompt.length}/1000</span>
              <button
                type="submit"
                disabled={prompt.trim().length < 10 || isCreatingProject}
                aria-label="Send prompt"
                className="grid size-7 place-items-center rounded-md bg-[#dddddf] text-[#111112] hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                {isCreatingProject ? (
                  <span className="text-[9px] font-semibold">...</span>
                ) : (
                  <ArrowUp size={15} />
                )}
              </button>
            </div>
          </div>
        </form>
      </section>
    </aside>
  );
}
