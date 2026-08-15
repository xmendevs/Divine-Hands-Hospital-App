import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch, clearToken, getToken, setToken } from "../api/client";

export interface User {
  id: string;
  username: string;
  email: string;
  status: string;
}

export interface Role {
  id: string;
  code: string;
  name: string;
}

export interface Me {
  id: string;
  username: string;
  email: string;
  status: string;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  staff: unknown;
  roles: Role[];
  permissions: string[];
}

export interface LoginResult {
  token: string;
  expiresAt: string;
  mustChangePassword: boolean;
  user: User;
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (username: string, password: string, totpCode?: string, deviceName?: string) => Promise<Me>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState<boolean>(() => getToken() !== null);

  async function refresh(): Promise<void> {
    const profile = await apiFetch<Me>("/auth/me");
    setMe(profile);
  }

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    refresh()
      .catch(() => {
        clearToken();
        setMe(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(username: string, password: string, totpCode?: string, deviceName?: string): Promise<Me> {
    const result = await apiFetch<LoginResult>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, totpCode, deviceName }),
    });
    setToken(result.token);
    const profile = await apiFetch<Me>("/auth/me");
    setMe(profile);
    return profile;
  }

  async function logout(): Promise<void> {
    try {
      await apiFetch<unknown>("/auth/logout", { method: "POST" });
    } catch {
      // Ignore logout errors; the local session is cleared either way.
    }
    clearToken();
    setMe(null);
  }

  return (
    <AuthContext.Provider value={{ me, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
