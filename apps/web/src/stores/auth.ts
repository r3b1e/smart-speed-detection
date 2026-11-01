import type { User } from "@smart-speed/shared";
import { create } from "zustand";
import { apiPost } from "../lib/api";
import { setAccessToken, setUnauthorizedHandler } from "../lib/session";

interface AuthResponse {
  user: User;
  accessToken: string;
}

interface AuthState {
  user: User | null;
  status: "booting" | "authed" | "guest";
  error: string | null;
  boot: () => Promise<void>;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  clearError: () => void;
}

function applyAuth(user: User, accessToken: string): void {
  setAccessToken(accessToken);
  useAuth.setState({ user, status: "authed", error: null });
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: "booting",
  error: null,

  async boot() {
    try {
      const res = await apiPost<AuthResponse>("/auth/refresh");
      if (res?.user && res?.accessToken) {
        applyAuth(res.user, res.accessToken);
        return;
      }
      set({ status: "guest" });
    } catch {
      set({ status: "guest" });
    }
  },

  async login(email, password) {
    set({ error: null });
    const res = await apiPost<AuthResponse>("/auth/login", { email, password });
    applyAuth(res.user, res.accessToken);
    return res.user;
  },

  async register(name, email, password) {
    set({ error: null });
    const res = await apiPost<AuthResponse>("/auth/register", { name, email, password });
    applyAuth(res.user, res.accessToken);
    return res.user;
  },

  async logout() {
    try {
      await apiPost<void>("/auth/logout");
    } catch {
      /* clearing local state is enough */
    }
    setAccessToken(null);
    set({ user: null, status: "guest", error: null });
  },

  clearError() {
    set({ error: null });
  },
}));

// A failed silent refresh anywhere in the app drops us back to the guest state.
setUnauthorizedHandler(() => {
  useAuth.setState({ user: null, status: "guest" });
});
