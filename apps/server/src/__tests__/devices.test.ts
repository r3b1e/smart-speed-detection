import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RegisteredUser, TestCtx } from "./helpers";
import { api, clearDb, createDevice, createUserWithRole, setupCtx, teardownCtx } from "./helpers";
import { AuditLogModel, Device } from "../models";
import { hashApiKey } from "../services/crypto";

let ctx: TestCtx;
let admin: RegisteredUser;

beforeAll(async () => {
  ctx = await setupCtx();
});

afterAll(async () => {
  await teardownCtx(ctx);
});

beforeEach(async () => {
  await clearDb();
  admin = await createUserWithRole(ctx.app, "admin");
});

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("devices CRUD", () => {
  it("creates a station, returns the API key once, stores only its hash", async () => {
    const { device, apiKey } = await createDevice(ctx.app, admin.accessToken, "Bandra Gate");
    expect(apiKey).toMatch(/^ssd_[0-9a-f]{48}$/);
    expect(device.id).toBeTruthy();

    const raw = await Device.findById(device.id);
    expect(raw).toBeTruthy();
    expect(raw!.apiKeyHash).not.toBe(apiKey);
    expect(raw!.apiKeyHash).toBe(hashApiKey(apiKey));
    expect(raw!.apiKeyPrefix).toBe(apiKey.slice(0, 12));

    // list responses never leak the key
    const list = await api(ctx.app).get("/api/devices").set(bearer(admin.accessToken));
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(apiKey);
    expect(list.body.items[0].apiKeyPrefix).toBe(apiKey.slice(0, 12));
  });

  it("rejects duplicate station names", async () => {
    await createDevice(ctx.app, admin.accessToken, "Dup Gate");
    const res = await api(ctx.app)
      .post("/api/devices")
      .set(bearer(admin.accessToken))
      .send({ name: "Dup Gate", location: { coordinates: [72.8, 19.0] } });
    expect(res.status).toBe(409);
  });

  it("allows only one registered gate", async () => {
    await createDevice(ctx.app, admin.accessToken, "Primary Gate");
    const res = await api(ctx.app)
      .post("/api/devices")
      .set(bearer(admin.accessToken))
      .send({ name: "Second Gate", location: { coordinates: [72.8, 19.0] } });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain("only one gate");
    expect(await Device.countDocuments()).toBe(1);
  });

  it("updates limit / scale factor / location and writes an audit entry", async () => {
    const { device } = await createDevice(ctx.app, admin.accessToken, "Editable");
    const res = await api(ctx.app)
      .patch(`/api/devices/${device.id}`)
      .set(bearer(admin.accessToken))
      .send({ speedLimitKmh: 60, scaleFactor: 8, location: { coordinates: [73.0, 19.1] } });
    expect(res.status).toBe(200);
    expect(res.body.device.speedLimitKmh).toBe(60);
    expect(res.body.device.scaleFactor).toBe(8);
    expect(res.body.device.location.coordinates).toEqual([73.0, 19.1]);

    const audits = await AuditLogModel.find({ action: "device.update" });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorName).toBe("admin user");
  });

  it("rotates the API key: new key differs, old hash replaced", async () => {
    const { device, apiKey } = await createDevice(ctx.app, admin.accessToken, "Rotating");
    const res = await api(ctx.app)
      .post(`/api/devices/${device.id}/rotate-key`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.apiKey).toBeTruthy();
    expect(res.body.apiKey).not.toBe(apiKey);
    const raw = await Device.findById(device.id);
    expect(raw!.apiKeyHash).toBe(hashApiKey(res.body.apiKey));
    expect(raw!.apiKeyHash).not.toBe(hashApiKey(apiKey));
  });

  it("DELETE soft-disables the station", async () => {
    const { device } = await createDevice(ctx.app, admin.accessToken, "Retiring");
    const res = await api(ctx.app)
      .delete(`/api/devices/${device.id}`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.device.status).toBe("disabled");
    expect((await Device.findById(device.id))!.status).toBe("disabled");
  });

  it("validates location coordinates", async () => {
    const res = await api(ctx.app)
      .post("/api/devices")
      .set(bearer(admin.accessToken))
      .send({ name: "Bad Gate", location: { coordinates: [999, 999] } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("settings singleton", () => {
  it("patches and persists admin settings with defaults on first read", async () => {
    const before = await api(ctx.app).get("/api/settings").set(bearer(admin.accessToken));
    expect(before.status).toBe(200);
    expect(before.body.settings.defaultLimitKmh).toBe(40);
    expect(before.body.settings.captureOffsetMs).toBe(200);

    const res = await api(ctx.app)
      .patch("/api/settings")
      .set(bearer(admin.accessToken))
      .send({ defaultLimitKmh: 55, alertSound: false, retentionDays: 30 });
    expect(res.status).toBe(200);
    expect(res.body.settings.defaultLimitKmh).toBe(55);
    expect(res.body.settings.alertSound).toBe(false);

    const again = await api(ctx.app).get("/api/settings").set(bearer(admin.accessToken));
    expect(again.body.settings.defaultLimitKmh).toBe(55);

    const audits = await AuditLogModel.find({ action: "settings.update" });
    expect(audits).toHaveLength(1);
  });

  it("rejects out-of-range limits", async () => {
    const res = await api(ctx.app)
      .patch("/api/settings")
      .set(bearer(admin.accessToken))
      .send({ defaultLimitKmh: 500 });
    expect(res.status).toBe(400);
  });
});
