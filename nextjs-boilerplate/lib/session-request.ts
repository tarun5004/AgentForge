import { AuthApiError } from "./auth-api.ts";

export type SessionAccess = {
  getAccessToken: () => string | null;
  refreshAccessToken: (rejectedToken: string) => Promise<string>;
};

// String tokens remain supported for small API-helper tests and non-reactive callers.
export type ProjectAccess = string | SessionAccess;

// Retry only a definite 401, once, with the identical body/key and original cancellation deadline.
export async function requestWithSession(url: string, access: ProjectAccess, init: RequestInit = {}): Promise<Response> {
  const token = typeof access === "string" ? access : access.getAccessToken();

  // Construct fresh headers so retry changes identity, not the caller's request or idempotency key.
  function send(accessToken: string | null): Promise<Response> {
    const headers = new Headers(init.headers);
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    return fetch(url, { ...init, headers });
  }

  const response = await send(token);
  if (response.status !== 401 || typeof access === "string") return response;
  init.signal?.throwIfAborted();
  let freshToken: string;
  try {
    freshToken = await access.refreshAccessToken(token ?? "");
  } catch (error) {
    // Keep the original Project 401 for the existing login redirect, but not on an outage.
    if (error instanceof AuthApiError && error.status === 401) return response;
    throw error;
  }
  init.signal?.throwIfAborted();
  return send(freshToken);
}
