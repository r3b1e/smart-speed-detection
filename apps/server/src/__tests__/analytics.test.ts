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
  const created = await createDevice(ctx.app, admin.accessToken, "Analytics Gate");
  deviceId = created.device.id;

  const now = new Date();
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startOfYesterday = startOfToday - 86_400_000;
  const at = (ms: number) => new Date(ms);

  // today (3 rows, 1... wait 2 overspeed → window always [midnight, now]):
  await insertDetection(deviceId, { scaledSpeedKmh: 20, detectedAt: at(startOfToday + 1_000) });
  await insertDetection(deviceId, {
    scaledSpeedKmh: 50,
    overspeed: true,
    severity: "medium",
    detectedAt: at(startOfToday + 2_000),
  });
  await insertDetection(deviceId, {
    scaledSpeedKmh: 70,
    overspeed: true,
    severity: "high",
    detectedAt: at(startOfToday + 3_000),
  });
  // yesterday (2 rows, 1 overspeed) — inside the previous-day window
  await insertDetection(deviceId, {
    scaledSpeedKmh: 30,
    detectedAt: at(startOfYesterday + 86_400_000 - 120_000),
  });
  await insertDetection(deviceId, {
    scaledSpeedKmh: 60,
    overspeed: true,
    severity: "medium",
    detectedAt: at(startOfYesterday + 86_400_000 - 60_000),
  });
});

describe("GET /api/analytics/summary", () => {
  it("computes totals, violation rate and trends for today", async () => {
    const res = await api(ctx.app)
      .get("/api/analytics/summary?period=today")
      .set(bearer(authority.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.period).toBe("today");
    expect(res.body.total.value).toBe(3);
    expect(res.body.overspeed.value).toBe(2);
    expect(res.body.violationRate).toBeCloseTo(0.667, 3);
    expect(res.body.avgSpeedKmh.value).toBeCloseTo(46.7, 1);
    expect(res.body.maxSpeedKmh).toBe(70);
    // yesterday had 2 rows for the same-length window → +50%
    expect(res.body.total.deltaPct).toBe(50);
    expect(res.body.generatedAt).toBeTruthy();
  });

  it("returns zeroed stats for an empty window", async () => {
    const res = await api(ctx.app)
      .get("/api/analytics/summary?from=2020-01-01&to=2020-01-02")
      .set(bearer(authority.accessToken));
    expect(res.body.total.value).toBe(0);
    expect(res.body.total.deltaPct).toBeNull();
    expect(res.body.violationRate).toBe(0);
  });

  it("is available to the user role, scoped to owned plates only", async () => {
    const { Vehicle, Detection } = await import("../models");
    await Vehicle.create({ ownerUserId: user.id, plate: "MH 99 TT 0001" });
    await Detection.updateOne({ scaledSpeedKmh: 20 }, { $set: { plate: "MH 99 TT 0001" } });

    const res = await api(ctx.app)
      .get("/api/analytics/summary?period=7d")
      .set(bearer(user.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.total.value).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain("MH 99 TT 0001");
  });
});

describe("GET /api/analytics/timeseries", () => {
  it("buckets by hour and sums to the window total", async () => {
    const res = await api(ctx.app)
      .get("/api/analytics/timeseries?bucket=hour")
      .set(bearer(authority.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.bucket).toBe("hour");
    const sum = res.body.points.reduce((acc: number, p: { total: number }) => acc + p.total, 0);
    expect(sum).toBe(5);
    expect(res.body.points.every((p: { t: string }) => p.t.endsWith("Z"))).toBe(true);
  });

  it("buckets by day", async () => {
    const res = await api(ctx.app)
      .get("/api/analytics/timeseries?bucket=day")
      .set(bearer(authority.accessToken));
    expect(res.body.points.length).toBeGreaterThanOrEqual(2);
  });
});

describe("GET /api/analytics/hourly-heatmap", () => {
  it("returns a 7×24 matrix whose total matches the rows", async () => {
    const res = await api(ctx.app)
      .get("/api/analytics/hourly-heatmap")
      .set(bearer(authority.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.matrix).toHaveLength(7);
    expect(res.body.matrix.every((row: number[]) => row.length === 24)).toBe(true);
    const sum = res.body.matrix.flat().reduce((a: number, b: number) => a + b, 0);
    expect(sum).toBe(5);
    expect(res.body.maxCount).toBeGreaterThanOrEqual(1);
    expect(res.body.overspeedMatrix.flat().reduce((a: number, b: number) => a + b, 0)).toBe(3);
  });
});

describe("GET /api/analytics/speed-distribution", () => {
  it("histogram counts sum to the total", async () => {
    const res = await api(ctx.app)
      .get("/api/analytics/speed-distribution")
      .set(bearer(authority.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.unit).toBe("km/h");
    const sum = res.body.buckets.reduce((a: number, b: { count: number }) => a + b.count, 0);
    expect(sum).toBe(5);
    const high = res.body.buckets.find((b: { from: number }) => b.from === 70);
    expect(high.count).toBe(1);
    expect(high.overspeed).toBe(1);
  });
});

describe("GET /api/analytics/by-device", () => {
  it("returns one row per station with violation rate", async () => {
    const res = await api(ctx.app)
      .get("/api/analytics/by-device")
      .set(bearer(authority.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    const row = res.body.rows[0];
    expect(row.name).toBe("Analytics Gate");
    expect(row.total).toBe(5);
    expect(row.overspeed).toBe(3);
    expect(row.violationRate).toBeCloseTo(0.6, 3);
    expect(row.maxSpeedKmh).toBe(70);
  });
});

describe("GET /api/analytics/top-violations", () => {
  it("sorts by percent over limit and is authority-only", async () => {
    const forbidden = await api(ctx.app)
      .get("/api/analytics/top-violations")
      .set(bearer(user.accessToken));
    expect(forbidden.status).toBe(403);

    const res = await api(ctx.app)
      .get("/api/analytics/top-violations")
      .set(bearer(authority.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(3);
    const pcts = res.body.rows.map((r: { overspeedByPct: number }) => r.overspeedByPct);
    expect(pcts).toEqual([...pcts].sort((a: number, b: number) => b - a));
    // 70 vs 40 limit = +75%
    expect(res.body.rows[0].overspeedByPct).toBe(75);
    expect(res.body.rows[0].deviceName).toBe("Analytics Gate");
  });
});
