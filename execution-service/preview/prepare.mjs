import { mkdir, writeFile, symlink } from "node:fs/promises";
import { dirname } from "node:path";
import { readInput } from "./read-input.mjs";
import { createFallbackLayout } from "./layout.mjs";

// This trusted entry point runs BEFORE generated code, with no host-mounted directories.
async function prepare() {
  const { files, previewPath } = await readInput(process.stdin);
  if (!/^\/preview\/[a-f0-9-]{36}\/[a-f0-9]{48}$/.test(previewPath)) throw new Error("Invalid preview path.");
  if (!Array.isArray(files) || files.length < 1 || files.length > 12) throw new Error("Invalid files.");
  await symlink("/app/node_modules", "/work/node_modules");
  await writeFile("/work/package.json", JSON.stringify({ private: true, dependencies: { next: "*", react: "*", "react-dom": "*" } }));
  await writeFile("/work/next.config.mjs", `export default ${JSON.stringify({
    output: "export", basePath: previewPath, trailingSlash: true,
    images: { unoptimized: true }, experimental: { cpus: 1, workerThreads: false },
  })};`);
  await writeFile("/work/tsconfig.json", JSON.stringify({ compilerOptions: {
    target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], strict: true, noEmit: true,
    esModuleInterop: true, module: "esnext", moduleResolution: "bundler", jsx: "react-jsx",
    resolveJsonModule: true, isolatedModules: true, skipLibCheck: true,
  }, include: ["**/*.ts", "**/*.tsx", ".next/types/**/*.ts"], exclude: ["node_modules"] }));
  await mkdir("/work/app");
  const fallbackLayout = createFallbackLayout(files);
  if (fallbackLayout !== null) await writeFile("/work/app/layout.tsx", fallbackLayout);
  for (const file of files) {
    if (typeof file.path !== "string" || !/^(app|components|lib)\/[a-zA-Z0-9_./-]+\.(tsx|ts|css)$/.test(file.path) ||
      file.path.split("/").some((part) => !part || part === "." || part === "..") ||
      typeof file.content !== "string" || file.content.length > 30_000) throw new Error("Invalid source.");
    const target = `/work/${file.path}`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, { flag: "wx" });
  }
}

await prepare();
