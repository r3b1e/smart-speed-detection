import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RegisteredUser, TestCtx } from "./helpers";
import {
  api,
  clearDb,
  createDevice,
  createUserWithRole,
  insertDetection,
  setupCtx,
  teardownCtx,
} from "./helpers";

let ctx: TestCtx;
let admin: RegisteredUser;
let authority: RegisteredUser;
let user: RegisteredUser;
let deviceId: string;

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ctx = await setupCtx();
});

afterAll(async () => {
  await teardownCtx(ctx);
});

beforeEach(async () => {
  await clearDb();
  admin = await createUserWithRole(ctx.app, "admin");
  authority = await createUserWithRole(ctx.app, "authority");
  user = await createUserWithRole(ctx.app, "user");
  const created = await createDevice(ctx.app, admin.accessToken, "Map Gate");
  deviceId = created.device.id;

  await insertDetection(deviceId, {
    scaledSpeedKmh: 60,
    overspeed: true,
    severity: "medium",
    location: { type: "Point", coordinates: [72.8777, 19.076] },
    detectedAt: new Date("2026-10-01T09:00:00Z"),
  });
  await insertDetection(deviceId, {
    scaledSpeedKmh: 35,
    location: { type: "Point", coordinates: [72.9, 19.1] },
    detectedAt: new Date("2026-10-01T10:00:00Z"),
  });
  await insertDetection(deviceId, {
    scaledSpeedKmh: 80,
    overspeed: true,
    severity: "high",
    location: { type: "Point", coordinates: [73.5, 19.5] },
    detectedAt: new Date("2026-10-02T11:00:00Z"),
  });
});

describe("GET /api/map/detections", () => {
  it("returns GeoJSON features inside a bbox", async () => {
    const res = await api(ctx.app)
      .get("/api/map/detections?bbox=72.8,19.0,73.0,19.2")
      .set(bearer(authority.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(2);
    expect(res.body.features[0].geometry.type).toBe("Point");
    expect(res.body.features[0].properties.severity).toBeTruthy();
  });

  it("returns 0 features for an empty bbox", async () => {
    const res = await api(ctx.app)
      .get("/api/map/detections?bbox=10,10,11,11")
      .set(bearer(authority.accessToken));
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(0);
  });

  it("filters by overspeed and severity", async () => {
    const res = await api(ctx.app)
      .get("/api/map/detections?overspeed=true&severity=high")
      .set(bearer(authority.accessToken));
    expect(res.body.features).toHaveLength(1);
    expect(res.body.features[0].properties.severity).toBe("high");
  });

  it("scopes map points to plates the user owns", async () => {
    const { Vehicle, Detection } = await import("../models");
    await Vehicle.create({ ownerUserId: user.id, plate: "MH 12 AB 4321" });
    const all = await Detection.find({});
    await all[0].set({ plate: "MH 12 AB 4321" }).save();
    await all[1].set({ plate: "GA 09 QQ 1111" }).save();
    await all[2].set({ plate: "KA 01 ZZ 5555" }).save();

    const mine = await api(ctx.app).get("/api/map/detections").set(bearer(user.accessToken));
    expect(mine.body.features).toHaveLength(1);
    expect(mine.body.features[0].properties.plate).toBe("MH 12 AB 4321");

    const authorityAll = await api(ctx.app)
      .get("/api/map/detections")
      .set(bearer(authority.accessToken));
    expect(authorityAll.body.features).toHaveLength(3);
  });

  it("rejects a malformed bbox", async () => {
    const res = await api(ctx.app)
      .get("/api/map/detections?bbox=1,2,3")
      .set(bearer(authority.accessToken));
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    expect((await api(ctx.app).get("/api/map/detections")).status).toBe(401);
  });
});

describe("GET /api/map/heat", () => {
  it("returns normalized points with intensity", async () => {
    const res = await api(ctx.app).get("/api/map/heat").set(bearer(authority.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(3);
    for (const p of res.body.points) {
      expect(p.lng).toBeGreaterThanOrEqual(-180);
      expect(p.lat).toBeGreaterThanOrEqual(-90);
      expect(p.weight).toBeGreaterThan(0);
    }
  });
});

describe("GET /api/map/devices", () => {
  it("lists station markers with status", async () => {
    const res = await api(ctx.app).get("/api/map/devices").set(bearer(authority.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.markers).toHaveLength(1);
    expect(res.body.markers[0].name).toBe("Map Gate");
    expect(res.body.markers[0].lng).toBe(72.8777);
    expect(res.body.markers[0].lat).toBe(19.076);
    expect(res.body.markers[0].bridgeOnline).toBeTypeOf("boolean");
  });
});
