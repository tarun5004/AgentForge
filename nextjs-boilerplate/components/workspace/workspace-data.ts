import type { GeneratedFile } from "@/lib/project-api";

// Keeping demo content outside the UI components makes it easy to replace
// this data with real backend responses later.

export type WorkspaceFile = {
  name: string;
  path: string;
  language: string;
  status: "A" | "M";
  content: string;
};

const languageByExtension: Record<string, string> = {
  css: "CSS",
  js: "JavaScript",
  jsx: "JSX",
  ts: "TypeScript",
  tsx: "TSX",
};

export function createWorkspaceFiles(files: GeneratedFile[]): WorkspaceFile[] {
  return files.map((file) => {
    const extension = file.path.split(".").pop()?.toLowerCase() ?? "";

    return {
      name: file.path.split("/").pop() ?? file.path,
      path: file.path,
      language: languageByExtension[extension] ?? "Text",
      status: "A",
      content: file.content,
    };
  });
}

export const workspaceFiles: WorkspaceFile[] = [
  {
    name: "page.tsx",
    path: "app/page.tsx",
    language: "TSX",
    status: "M",
    content: `export default function PortfolioPage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <section className="mx-auto max-w-5xl px-6 py-24">
        <p className="text-sm text-emerald-400">Frontend Developer</p>
        <h1 className="mt-4 text-6xl font-semibold tracking-tight">
          I build thoughtful digital products.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-neutral-400">
          Clean interfaces, reliable systems, and fast experiences.
        </p>
      </section>
    </main>
  );
}`,
  },
  {
    name: "Hero.tsx",
    path: "components/Hero.tsx",
    language: "TSX",
    status: "A",
    content: `type HeroProps = {
  title: string;
  description: string;
};

export function Hero({ title, description }: HeroProps) {
  return (
    <section className="py-24">
      <h1 className="text-6xl font-semibold">{title}</h1>
      <p className="mt-6 text-neutral-400">{description}</p>
    </section>
  );
}`,
  },
  {
    name: "globals.css",
    path: "app/globals.css",
    language: "CSS",
    status: "M",
    content: `@import "tailwindcss";

:root {
  color-scheme: dark;
  --background: #0f0f10;
  --foreground: #d6d6d6;
}

body {
  background: var(--background);
  color: var(--foreground);
}`,
  },
];

export const sampleAssistantMessage = `### Plan

- Create a focused hero section
- Use a neutral dark palette
- Keep the layout responsive

Sample changes are visible in \`page.tsx\` and \`Hero.tsx\`.`;

export const terminalOutput = [
  "> agentforge-preview@0.1.0 dev",
  "> next dev",
  "",
  "▲ Next.js 16.3.1",
  "- Local: http://localhost:3000",
  "",
  "✓ Ready in 842ms",
];

export const agentTasks = [
  { label: "Understand the request", done: true },
  { label: "Create page structure", done: true },
  { label: "Polish responsive styles", done: false },
  { label: "Run project checks", done: false },
];
