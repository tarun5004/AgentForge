// Track only a successful registration response, never a guessed email or an arbitrary response ID.
export function registeredDemoUserId(method: string, path: string, status: number, body: unknown): string | null {
  if (method !== "POST" || path !== "/api/auth/register" || status !== 201 ||
      !body || typeof body !== "object" || !("user" in body)) return null;
  const user = body.user;
  if (!user || typeof user !== "object" || !("id" in user)) return null;
  return typeof user.id === "string" && /^[a-f\d]{24}$/i.test(user.id) ? user.id : null;
}
