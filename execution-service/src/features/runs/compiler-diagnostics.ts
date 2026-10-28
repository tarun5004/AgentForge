export type CompilerDiagnostic = {
  path: string | null;
  line: number | null;
  column: number | null;
  category: "typescript" | "module" | "syntax" | "compile";
  code: string | null;
};

// Treat compiler output as hostile: keep locations and fixed labels, never quoted messages or source.
export function compilerDiagnostics(output: string, files: { path: string }[]): CompilerDiagnostic[] {
  const lines = output.slice(-4_000).replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/);
  const diagnostics: CompilerDiagnostic[] = [];
  for (let index = 0; index < lines.length && diagnostics.length < 8; index++) {
    const text = lines[index]!.trim();
    // Match a complete known path, not a substring of an arbitrary host path or a log sentence.
    const file = files.find(({ path }) => text === path || text === `./${path}` ||
      text.startsWith(`${path}:`) || text.startsWith(`./${path}:`) ||
      text.startsWith(`${path}(`) || text.startsWith(`./${path}(`));
    if (!file) continue;
    const suffix = text.slice(text.startsWith("./") ? file.path.length + 2 : file.path.length);
    const location = /^(?::|\()(\d{1,6})(?::|,\s*)(\d{1,6})(?:\)|:|\s|$)/.exec(suffix);
    const context = `${text}\n${lines[index + 1] ?? ""}`;
    const code = /\bTS\d{4,5}\b/.exec(context)?.[0] ?? null;
    const category = code || /Type error|TypeScript/i.test(context) ? "typescript"
      : /Module not found|Can't resolve/i.test(context) ? "module"
      : /Syntax error|Unexpected token|Parsing error/i.test(context) ? "syntax" : "compile";
    const diagnostic: CompilerDiagnostic = {
      path: file.path, line: location && Number(location[1]) > 0 ? Number(location[1]) : null,
      column: location && Number(location[2]) > 0 ? Number(location[2]) : null, category, code,
    };
    if (!diagnostics.some((entry) => JSON.stringify(entry) === JSON.stringify(diagnostic))) diagnostics.push(diagnostic);
  }
  // Unknown formats still explain that compilation failed without echoing any compiler text.
  return diagnostics.length ? diagnostics : [{ path: null, line: null, column: null, category: "compile", code: null }];
}
