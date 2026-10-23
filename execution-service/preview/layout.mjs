// Only fill a missing layout; a supplied layout keeps control of its own structure and CSS imports.
export function createFallbackLayout(files) {
  if (files.some(file => file.path === "app/layout.tsx")) return null;

  // CSS must enter Next's import graph, but importing an absent file would break page-only snapshots.
  const stylesheet = files.some(file => file.path === "app/globals.css") ? 'import "./globals.css";\n' : "";
  return `${stylesheet}import type { ReactNode } from "react";
export default function Layout({children}: {children: ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}`;
}
