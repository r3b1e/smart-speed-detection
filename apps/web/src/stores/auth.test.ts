import type { User } from "@smart-speed/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as sessionModule from "../lib/session";
import { apiPost } from "../lib/api";
import { setAccessToken } from "../lib/session";
import { useAuth } from "./auth";

vi.mock("../lib/api", () => ({ apiPost: vi.fn() }));

vi.mock("../lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof sessionModule>();
  return { ...actual, setAccessToken: vi.fn() };
});

const admin: User = {
  id: "u1",
  name: "Ada Admin",
  email: "admin@smartspeed.local",
  role: "admin",
  isActive: true,
  lastLoginAt: null,
  createdAt: "2026-10-01T00:00:00Z",
};

describe("auth store", () => {
  beforeEach(() => {
    useAuth.setState({ user: null, status: "guest", error: null });
    vi.clearAllMocks();
  });

  it("boot goes guest when the refresh request fails", async () => {
    vi.mocked(apiPost).mockRejectedValue(new Error("network"));
    await useAuth.getState().boot();
    expect(useAuth.getState().status).toBe("guest");
    expect(useAuth.getState().user).toBeNull();
  });

  it("boot restores a session from the refresh response", async () => {
    vi.mocked(apiPost).mockResolvedValue({ user: admin, accessToken: "tok-1" });
    await useAuth.getState().boot();
    expect(useAuth.getState().status).toBe("authed");
    expect(useAuth.getState().user?.email).toBe(admin.email);
    expect(setAccessToken).toHaveBeenCalledWith("tok-1");
  });

  it("login stores the user and token", async () => {
    vi.mocked(apiPost).mockResolvedValue({ user: admin, accessToken: "tok-2" });
    const user = await useAuth.getState().login(admin.email, "Demo@1234");
    expect(user.email).toBe(admin.email);
    expect(useAuth.getState().status).toBe("authed");
    expect(setAccessToken).toHaveBeenCalledWith("tok-2");
    expect(apiPost).toHaveBeenCalledWith("/auth/login", {
      email: admin.email,
      password: "Demo@1234",
    });
  });

  it("login failure leaves the session untouched", async () => {
    useAuth.setState({ status: "guest" });
    vi.mocked(apiPost).mockRejectedValue(new Error("bad credentials"));
    await expect(useAuth.getState().login(admin.email, "nope")).rejects.toThrow("bad credentials");
    expect(useAuth.getState().status).toBe("guest");
    expect(setAccessToken).not.toHaveBeenCalled();
  });

  it("logout clears the user and wipes the stored token", async () => {
    useAuth.setState({ user: admin, status: "authed" });
    await useAuth.getState().logout();
    expect(useAuth.getState().status).toBe("guest");
    expect(useAuth.getState().user).toBeNull();
    expect(setAccessToken).toHaveBeenCalledWith(null);
  });
});
