export type AuthUser = {
  id: string;
  name: string;
  email: string;
};

export type AuthSession = {
  user: AuthUser;
  accessToken: string;
};

type LoginInput = {
  email: string;
  password: string;
};

type RegisterInput = LoginInput & {
  name: string;
};

// Only an explicit auth rejection should end a session; network/server failures should not.
export class AuthApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!isRecord(value) || !isRecord(value.user)) {
    return false;
  }

  return (
    typeof value.accessToken === "string" &&
    typeof value.user.id === "string" &&
    typeof value.user.name === "string" &&
    typeof value.user.email === "string"
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestSession(
  endpoint: "login" | "register" | "refresh",
  body?: LoginInput | RegisterInput,
): Promise<AuthSession> {
  const response = await fetch(`/api/auth/${endpoint}`, {
    method: "POST",
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  const responseBody = await readJson(response);

  if (!response.ok) {
    const message =
      isRecord(responseBody) && typeof responseBody.message === "string"
        ? responseBody.message
        : "Authentication request failed.";

    throw new AuthApiError(message, response.status);
  }

  if (!isAuthSession(responseBody)) {
    throw new Error("Auth Service returned an invalid response.");
  }

  return responseBody;
}

export function login(input: LoginInput): Promise<AuthSession> {
  return requestSession("login", input);
}

export function register(input: RegisterInput): Promise<AuthSession> {
  return requestSession("register", input);
}

let refreshRequest: Promise<AuthSession> | null = null;

export function refreshSession(): Promise<AuthSession> {
  // Reuse an active refresh call so React development checks cannot rotate
  // the same refresh token twice at the same time.
  if (!refreshRequest) {
    refreshRequest = requestSession("refresh").finally(() => {
      refreshRequest = null;
    });
  }

  return refreshRequest;
}

export async function logout(): Promise<void> {
  // Finish cookie rotation before revoking it; a late refresh must not reinstall a logout cookie.
  if (refreshRequest) await refreshRequest.catch(() => undefined);
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const responseBody = await readJson(response);
    const message =
      isRecord(responseBody) && typeof responseBody.message === "string"
        ? responseBody.message
        : "Could not sign out.";

    throw new Error(message);
  }
}
