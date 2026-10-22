import { createServer } from "node:http";
import { extname } from "node:path";
import type { RunService } from "./run.service.js";
import { getPreviewFrameAncestors } from "./preview.policy.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".txt": "text/plain; charset=utf-8",
  ".png": "image/png", ".ico": "image/x-icon", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2",
};

// A separate loopback origin serves bytes only: no app cookies, backend proxy or source execution.
export function createPreviewServer(service: Pick<RunService, "artifact">, frontendOrigin?: string) {
  const frameAncestors = getPreviewFrameAncestors(frontendOrigin);
  return createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("Content-Security-Policy", `sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors ${frameAncestors}`);
    try {
      if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? "") || !["GET", "HEAD"].includes(req.method ?? "")) throw new Error();
      const path = decodeURIComponent((req.url ?? "").split("?")[0]!);
      const match = /^\/preview\/([a-f0-9-]{36})\/([a-f0-9]{48})\/(.*)$/.exec(path);
      if (!match) throw new Error();
      let file = match[3]!;
      if (file.endsWith("/") || file === "") file += "index.html";
      if (file.split("/").some((part) => part === ".." || part === "." || !part)) throw new Error();
      const content = service.artifact(match[1]!, match[2]!, file);
      if (!content) throw new Error();
      res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
      res.setHeader("Content-Length", content.length);
      res.end(req.method === "HEAD" ? undefined : content);
    } catch {
      res.statusCode = 404;
      res.end("Preview not found or expired.");
    }
  });
}
