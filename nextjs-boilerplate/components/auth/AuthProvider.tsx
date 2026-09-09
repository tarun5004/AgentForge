"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  login as loginRequest,
  logout as logoutRequest,
  refreshSession,
  register as registerRequest,
  type AuthSession,
  type AuthUser,
} from "@/lib/auth-api";

type AuthContextValue = {
  user: AuthUser | null;
  accessToken: string | null;
  isCheckingSession: boolean;
  login: (input: { email: string; password: string }) => Promise<void>;
  register: (input: { name: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  function saveSession(session: AuthSession) {
    setUser(session.user);
    setAccessToken(session.accessToken);
  }

  useEffect(() => {
    let shouldUpdateState = true;

    refreshSession()
      .then((session) => {
        if (shouldUpdateState) {
          saveSession(session);
        }
      })
      .catch(() => {
        if (shouldUpdateState) {
          setUser(null);
          setAccessToken(null);
        }
      })
      .finally(() => {
        if (shouldUpdateState) {
          setIsCheckingSession(false);
        }
      });

    return () => {
      shouldUpdateState = false;
    };
  }, []);

  async function login(input: { email: string; password: string }) {
    saveSession(await loginRequest(input));
  }

  async function register(input: { name: string; email: string; password: string }) {
    saveSession(await registerRequest(input));
  }

  async function logout() {
    await logoutRequest();
    setUser(null);
    setAccessToken(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, accessToken, isCheckingSession, login, register, logout }}
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
