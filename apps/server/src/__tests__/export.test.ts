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
  const created = await createDevice(ctx.app, admin.accessToken, "Export Gate");
  deviceId = created.device.id;
  await insertDetection(deviceId, {
    scaledSpeedKmh: 55,
    overspeed: true,
    severity: "medium",
    plate: "MH 12 AB 4321",
    detectedAt: new Date("2026-10-01T08:30:00Z"),
  });
  await insertDetection(deviceId, {
    scaledSpeedKmh: 30,
    plate: null,
    detectedAt: new Date("2026-10-02T18:00:00Z"),
  });
});

describe("GET /api/export/detections.csv", () => {
  it("streams a CSV with header and rows for authority", async () => {
    const res = await api(ctx.app)
      .get("/api/export/detections.csv")
      .set(bearer(authority.accessToken));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    const text = res.text;
    const lines = text.trim().split(/\r?\n/);
    expect(lines[0]).toContain("detectedAt");
    expect(lines[0]).toContain("scaledKmh");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(text).toContain("MH 12 AB 4321");
    expect(text).toContain("Export Gate");
  });

  it("escapes commas and quotes in plate values", async () => {
    const { Detection } = await import("../models");
    await Detection.collection.insertOne({
      deviceId,
      bootId: "csv-test",
      seq: 1,
      source: "arduino",
      vehicleUid: "csv-uid",
      measuredSpeedKmh: 50,
      scaledSpeedKmh: 50,
      limitKmh: 40,
      overspeed: true,
      severity: "low",
      direction: "fwd",
      dtMicros: 7200,
      detectedAt: new Date(),
      receivedAt: new Date(),
      location: { type: "Point", coordinates: [72.8, 19.0] },
      frame: { status: "failed" },
      plate: 'AB, "CD" EF',
      review: { status: "pending" },
      fine: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await api(ctx.app)
      .get("/api/export/detections.csv")
      .set(bearer(authority.accessToken));
    expect(res.text).toContain('"AB, ""CD"" EF"');
  });

  it("filters like the list endpoint", async () => {
    const res = await api(ctx.app)
      .get("/api/export/detections.csv?overspeed=true")
      .set(bearer(authority.accessToken));
    expect(res.text.trim().split(/\r?\n/)).toHaveLength(2); // header + 1
  });

  it("is forbidden for the user role", async () => {
    const res = await api(ctx.app).get("/api/export/detections.csv").set(bearer(user.accessToken));
    expect(res.status).toBe(403);
  });

  it("requires authentication", async () => {
    expect((await api(ctx.app).get("/api/export/detections.csv")).status).toBe(401);
  });
});

describe("GET /api/export/detections.pdf", () => {
  it("streams a PDF report for admin", async () => {
    const res = await api(ctx.app).get("/api/export/detections.pdf").set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("attachment");
    const buf = res.body as unknown as Buffer;
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(500);
  });

  it("is forbidden for the user role", async () => {
    const res = await api(ctx.app).get("/api/export/detections.pdf").set(bearer(user.accessToken));
    expect(res.status).toBe(403);
  });
});
