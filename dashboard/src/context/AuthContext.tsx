import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  apiGet,
  apiPost,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
  setUnauthorizedHandler,
} from "../lib/api";
import type { AuthMe, Role, TokenEnvelope, User } from "../lib/types";
import { useToast } from "./ToastContext";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  user: User | null;
  permissions: string[];
  status: AuthStatus;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<User>;
  can: (permission: string) => boolean;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [status, setStatus] = useState<AuthStatus>(
    getAccessToken() ? "loading" : "anonymous",
  );
  const toast = useToast();

  const applyMe = useCallback((me: AuthMe) => {
    setUser(me.user);
    setPermissions(me.permissions);
    setStatus("authenticated");
  }, []);

  const clearSession = useCallback(() => {
    clearTokens();
    setUser(null);
    setPermissions([]);
    setStatus("anonymous");
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
      toast.error("Session expired", "Please sign in again to continue.");
    });
    return () => setUnauthorizedHandler(null);
  }, [clearSession, toast]);

  useEffect(() => {
    if (!getAccessToken()) {
      setStatus("anonymous");
      return;
    }
    let active = true;
    apiGet<AuthMe>("/api/v1/auth/me")
      .then((me) => {
        if (active) applyMe(me);
      })
      .catch(() => {
        if (active) clearSession();
      });
    return () => {
      active = false;
    };
  }, [applyMe, clearSession]);

  const login = useCallback(async (username: string, password: string) => {
    const tokens = await apiPost<TokenEnvelope>("/api/v1/auth/login", {
      username,
      password,
    });
    setTokens(tokens.access_token, tokens.refresh_token);
    setUser(tokens.user);
    setPermissions(tokens.permissions);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    try {
      await apiPost<void>(
        "/api/v1/auth/logout",
        refreshToken ? { refresh_token: refreshToken } : {},
      );
    } catch {
      // The local session is cleared even if the API is unreachable.
    }
    clearSession();
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    const me = await apiGet<AuthMe>("/api/v1/auth/me");
    applyMe(me);
    return me.user;
  }, [applyMe]);

  const can = useCallback(
    (permission: string) => permissions.includes(permission),
    [permissions],
  );

  const hasRole = useCallback(
    (...roles: Role[]) => (user ? roles.includes(user.role) : false),
    [user],
  );

  const value = useMemo(
    () => ({
      user,
      permissions,
      status,
      login,
      logout,
      refreshUser,
      can,
      hasRole,
    }),
    [user, permissions, status, login, logout, refreshUser, can, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
