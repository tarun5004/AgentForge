"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  AuthApiError,
  login as loginRequest,
  logout as logoutRequest,
  refreshSession,
  register as registerRequest,
  type AuthSession,
  type AuthUser,
} from "@/lib/auth-api";
import type { SessionAccess } from "@/lib/session-request";

type AuthContextValue = {
  user: AuthUser | null;
  accessToken: string | null;
  isCheckingSession: boolean;
  login: (input: { email: string; password: string }) => Promise<void>;
  register: (input: { name: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  invalidateSession: () => void;
  projectSession: SessionAccess;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const tokenRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const sessionVersion = useRef(0);
  const logoutInProgress = useRef(false);

  // A rejected token must also clear identity, or the login page redirects straight back.
  // Keep this callback stable because workspace fetch effects depend on it.
  const invalidateSession = useCallback(() => {
    sessionVersion.current += 1;
    tokenRef.current = null;
    userIdRef.current = null;
    setUser(null);
    setAccessToken(null);
  }, []);

  // Update the ref immediately so concurrent requests don't reuse a rejected token before render.
  const saveSession = useCallback((session: AuthSession) => {
    tokenRef.current = session.accessToken;
    userIdRef.current = session.user.id;
    setUser(session.user);
    setAccessToken(session.accessToken);
  }, []);

  // Late 401s reuse a newer token; active refreshes share auth-api's one rotating-cookie request.
  const refreshAccessToken = useCallback(async (rejectedToken: string): Promise<string> => {
    if (logoutInProgress.current) throw new Error("Signing out. Please wait.");
    if (!tokenRef.current) throw new AuthApiError("Please sign in again.", 401);
    if (tokenRef.current !== rejectedToken) return tokenRef.current;
    const version = sessionVersion.current;
    const ownerId = userIdRef.current;
    const session = await refreshSession();
    // A late refresh must never undo logout or overwrite a newly signed-in account.
    if (version !== sessionVersion.current) throw new Error("Session changed. Please try again.");
    if (session.user.id !== ownerId) throw new AuthApiError("Session changed. Please sign in again.", 401);
    saveSession(session);
    return session.accessToken;
  }, [saveSession]);

  // Keep this object stable: renewing a token must not restart workspace reads or discard drafts.
  const userId = user?.id ?? null;
  const projectSession = useMemo<SessionAccess>(() => ({
    getAccessToken: () => userIdRef.current === userId ? tokenRef.current : null,
    refreshAccessToken: (rejectedToken) => {
      // An old operation must never retry using a different account's new token.
      if (userIdRef.current !== userId) return Promise.reject(new Error("Session changed. Please try again."));
      return refreshAccessToken(rejectedToken);
    },
  }), [userId, refreshAccessToken]);

  useEffect(() => {
    let shouldUpdateState = true;
    const version = sessionVersion.current;

    refreshSession()
      .then((session) => {
        if (shouldUpdateState && version === sessionVersion.current) {
          saveSession(session);
        }
      })
      .catch(() => {
        // Initial restoration has no known session to preserve; later request failures do.
      })
      .finally(() => {
        if (shouldUpdateState) {
          setIsCheckingSession(false);
        }
      });

    return () => {
      shouldUpdateState = false;
    };
  }, [saveSession]);

  // A newer login/logout takes precedence over any older in-flight authentication response.
  async function login(input: { email: string; password: string }) {
    const version = ++sessionVersion.current;
    const session = await loginRequest(input);
    if (version === sessionVersion.current) saveSession(session);
  }

  // Register through the existing service while preventing a late response from replacing identity.
  async function register(input: { name: string; email: string; password: string }) {
    const version = ++sessionVersion.current;
    const session = await registerRequest(input);
    if (version === sessionVersion.current) saveSession(session);
  }

  // Invalidate pending refresh work before waiting for the server to clear its cookie.
  async function logout() {
    sessionVersion.current += 1;
    logoutInProgress.current = true;
    try {
      await logoutRequest();
      invalidateSession();
    } finally {
      logoutInProgress.current = false;
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, accessToken, isCheckingSession, login, register, logout, invalidateSession, projectSession }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}
