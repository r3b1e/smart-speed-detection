import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RegisteredUser, TestCtx } from "./helpers";
import { api, createUserWithRole, setupCtx, teardownCtx } from "./helpers";

let ctx: TestCtx;
let admin: RegisteredUser;
let authority: RegisteredUser;
let user: RegisteredUser;

beforeAll(async () => {
  ctx = await setupCtx();
  admin = await createUserWithRole(ctx.app, "admin");
  authority = await createUserWithRole(ctx.app, "authority");
  user = await createUserWithRole(ctx.app, "user");
});

afterAll(async () => {
  await teardownCtx(ctx);
});

beforeEach(async () => {
  // roles stay, data is reset between tests where needed
});

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("RBAC matrix", () => {
  it("admin can list users; authority and user cannot", async () => {
    expect((await api(ctx.app).get("/api/users").set(bearer(admin.accessToken))).status).toBe(200);
    expect((await api(ctx.app).get("/api/users").set(bearer(authority.accessToken))).status).toBe(
      403
    );
    expect((await api(ctx.app).get("/api/users").set(bearer(user.accessToken))).status).toBe(403);
    expect((await api(ctx.app).get("/api/users")).status).toBe(401);
  });

  it("only admin can create devices", async () => {
    const body = { name: "RBAC Gate", location: { coordinates: [72.87, 19.07] } };
    expect(
      (await api(ctx.app).post("/api/devices").set(bearer(admin.accessToken)).send(body)).status
    ).toBe(201);
    expect(
      (await api(ctx.app).post("/api/devices").set(bearer(authority.accessToken)).send(body)).status
    ).toBe(403);
    expect(
      (await api(ctx.app).post("/api/devices").set(bearer(user.accessToken)).send(body)).status
    ).toBe(403);
  });

  it("authority and admin can read stations, user cannot", async () => {
    expect((await api(ctx.app).get("/api/devices").set(bearer(authority.accessToken))).status).toBe(
      200
    );
    expect((await api(ctx.app).get("/api/devices").set(bearer(admin.accessToken))).status).toBe(
      200
    );
    expect((await api(ctx.app).get("/api/devices").set(bearer(user.accessToken))).status).toBe(403);
  });

  it("only admin can read audit log and patch settings", async () => {
    expect((await api(ctx.app).get("/api/audit").set(bearer(admin.accessToken))).status).toBe(200);
    expect((await api(ctx.app).get("/api/audit").set(bearer(authority.accessToken))).status).toBe(
      403
    );
    expect(
      (
        await api(ctx.app)
          .patch("/api/settings")
          .set(bearer(authority.accessToken))
          .send({ defaultLimitKmh: 50 })
      ).status
    ).toBe(403);
    expect(
      (
        await api(ctx.app)
          .patch("/api/settings")
          .set(bearer(admin.accessToken))
          .send({ defaultLimitKmh: 50 })
      ).status
    ).toBe(200);
  });

  it("all three roles can read settings, unauthenticated cannot", async () => {
    for (const t of [admin, authority, user]) {
      expect((await api(ctx.app).get("/api/settings").set(bearer(t.accessToken))).status).toBe(200);
    }
    expect((await api(ctx.app).get("/api/settings")).status).toBe(401);
  });

  it("register always creates role=user (no privilege escalation)", async () => {
    const res = await api(ctx.app)
      .post("/api/auth/register")
      .send({ name: "Sneaky", email: "sneaky@test.local", password: "Secret123" });
    expect(res.body.user.role).toBe("user");
    const res2 = await api(ctx.app)
      .post("/api/auth/register")
      .send({ name: "Sneaky2", email: "sneaky2@test.local", password: "Secret123", role: "admin" });
    expect(res2.body.user.role).toBe("user");
  });
});
