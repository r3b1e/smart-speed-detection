import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TestCtx } from "./helpers";
import { api, clearDb, registerUser, setupCtx, teardownCtx } from "./helpers";

let ctx: TestCtx;

beforeAll(async () => {
  ctx = await setupCtx();
});

afterAll(async () => {
  await teardownCtx(ctx);
});

beforeEach(async () => {
  await clearDb();
});

describe("POST /api/auth/register", () => {
  it("creates a user with role=user and returns tokens", async () => {
    const res = await api(ctx.app)
      .post("/api/auth/register")
      .send({ name: "New Driver", email: "new@test.local", password: "Secret123" });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("user");
    expect(res.body.user.email).toBe("new@test.local");
    expect(res.body.user).not.toHaveProperty("passwordHash");
    expect(res.body.accessToken).toBeTruthy();
    const cookie = res.headers["set-cookie"]?.join(";") ?? "";
    expect(cookie).toContain("ssd_refresh=");
    expect(cookie).toContain("HttpOnly");
  });

  it("rejects duplicate emails with CONFLICT", async () => {
    await registerUser(ctx.app, { email: "dup@test.local" });
    const res = await api(ctx.app)
      .post("/api/auth/register")
      .send({ name: "Impostor", email: "dup@test.local", password: "Secret123" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("rejects weak passwords with VALIDATION_ERROR", async () => {
    const res = await api(ctx.app)
      .post("/api/auth/register")
      .send({ name: "Weak", email: "weak@test.local", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials and updates lastLoginAt", async () => {
    const user = await registerUser(ctx.app);
    const res = await api(ctx.app)
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password });
    expect(res.status).toBe(200);
    expect(res.body.user.lastLoginAt).toBeTruthy();
  });

  it("returns UNAUTHORIZED for a wrong password", async () => {
    const user = await registerUser(ctx.app);
    const res = await api(ctx.app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "Wrong1234" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("blocks deactivated accounts", async () => {
    const user = await registerUser(ctx.app);
    const { User } = await import("../models");
    await User.findByIdAndUpdate(user.id, { isActive: false });
    const res = await api(ctx.app)
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password });
    expect(res.status).toBe(403);
  });
});

describe("refresh / logout / me", () => {
  it("refreshes the access token using the httpOnly cookie", async () => {
    const agent = api(ctx.app);
    const reg = await agent
      .post("/api/auth/register")
      .send({ name: "Refresher", email: "refresh@test.local", password: "Secret123" });
    const firstAccess = reg.body.accessToken as string;

    const refresh = await agent.post("/api/auth/refresh");
    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).toBeTruthy();
    expect(refresh.body.accessToken).not.toBe(firstAccess);

    const me = await agent
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${refresh.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("refresh@test.local");
  });

  it("rejects refresh without a cookie", async () => {
    const res = await api(ctx.app).post("/api/auth/refresh");
    expect(res.status).toBe(401);
  });

  it("logout revokes the refresh session", async () => {
    const agent = api(ctx.app);
    await agent.post("/api/auth/register").send({
      name: "Logout",
      email: "logout@test.local",
      password: "Secret123",
    });
    const out = await agent.post("/api/auth/logout");
    expect(out.status).toBe(204);
    const after = await agent.post("/api/auth/refresh");
    expect(after.status).toBe(401);
  });

  it("GET /me requires a valid access token", async () => {
    const res = await api(ctx.app).get("/api/auth/me");
    expect(res.status).toBe(401);
    const bad = await api(ctx.app).get("/api/auth/me").set("Authorization", "Bearer nope");
    expect(bad.status).toBe(401);
  });
});
