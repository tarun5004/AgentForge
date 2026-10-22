const DEFAULT_FRAME_ANCESTORS = "http://localhost:3001 http://127.0.0.1:3001";

// Keep embedding local and explicit; a custom frontend port must not become a wildcard policy.
export function getPreviewFrameAncestors(frontendOrigin: string | undefined): string {
  if (frontendOrigin === undefined) return DEFAULT_FRAME_ANCESTORS;
  const message = "PREVIEW_FRONTEND_ORIGIN must be an exact loopback HTTP origin without credentials, path, query or fragment.";
  let url: URL;
  try { url = new URL(frontendOrigin); }
  catch { throw new Error(message); }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      /[\s?#]/.test(frontendOrigin)) {
    throw new Error(message);
  }
  return url.origin;
}
