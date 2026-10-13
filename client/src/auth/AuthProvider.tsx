import { createContext, useContext, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api/http";
import { keys } from "../api/queries";
import type { User } from "../api/types";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const me = useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return (await api<{ user: User }>("/auth/me")).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
    retry: false,
  });

  const login = useMutation({
    mutationFn: (creds: { email: string; password: string }) => api<{ user: User }>("/auth/login", { method: "POST", json: creds }),
    onSuccess: ({ user }) => {
      qc.clear(); // never show the previous user's cached data
      qc.setQueryData(keys.me, user);
    },
  });

  const value: AuthContextValue = {
    user: me.data ?? null,
    isLoading: me.isLoading,
    login: async (email, password) => (await login.mutateAsync({ email, password })).user,
    logout: async () => {
      await api("/auth/logout", { method: "POST" }).catch(() => undefined);
      qc.clear();
      qc.setQueryData(keys.me, null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
