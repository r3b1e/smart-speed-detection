import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { AuditLogModel, Detection, Vehicle } from "../models";

let ctx: TestCtx;
let admin: RegisteredUser;
let authority: RegisteredUser;
let user: RegisteredUser;
let deviceId: string;

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
  const created = await createDevice(ctx.app, admin.accessToken, "Table Gate");
  deviceId = created.device.id;
  await Vehicle.create({ ownerUserId: user.id, plate: "MH 12 AB 4321" });
});

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("GET /api/detections", () => {
  beforeEach(async () => {
    await insertDetection(deviceId, {
      scaledSpeedKmh: 55,
      overspeed: true,
      severity: "medium",
      plate: "MH 12 AB 4321",
      detectedAt: new Date("2026-10-01T08:00:00Z"),
    });
    await insertDetection(deviceId, {
      scaledSpeedKmh: 30,
      overspeed: false,
      severity: "low",
      plate: "GA 09 QQ 1111",
      detectedAt: new Date("2026-10-01T18:00:00Z"),
    });
    await insertDetection(deviceId, {
      scaledSpeedKmh: 70,
      overspeed: true,
      severity: "high",
      plate: null,
      detectedAt: new Date("2026-10-02T08:00:00Z"),
    });
  });

  it("lists all detections for authority with filters, sort and pagination", async () => {
    const all = await api(ctx.app).get("/api/detections").set(bearer(authority.accessToken));
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(3);
    expect(all.body.items[0].deviceName).toBe("Table Gate");

    const over = await api(ctx.app)
      .get("/api/detections?overspeed=true")
      .set(bearer(authority.accessToken));
    expect(over.body.total).toBe(2);

    const bySpeed = await api(ctx.app)
      .get("/api/detections?sort=-scaledSpeedKmh")
      .set(bearer(authority.accessToken));
    expect(bySpeed.body.items[0].scaledSpeedKmh).toBe(70);

    const paged = await api(ctx.app)
      .get("/api/detections?limit=2&page=2")
      .set(bearer(authority.accessToken));
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.totalPages).toBe(2);

    const byPlate = await api(ctx.app)
      .get("/api/detections?plate=mh%2012%20ab%204321")
      .set(bearer(authority.accessToken));
    expect(byPlate.body.total).toBe(1);

    const search = await api(ctx.app)
      .get("/api/detections?q=GA%2009")
      .set(bearer(authority.accessToken));
    expect(search.body.total).toBe(1);

    const range = await api(ctx.app)
      .get("/api/detections?from=2026-10-02&to=2026-10-02")
      .set(bearer(authority.accessToken));
    expect(range.body.total).toBe(1);
  });

  it("scopes a user to their own plates only", async () => {
    const res = await api(ctx.app).get("/api/detections").set(bearer(user.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].plate).toBe("MH 12 AB 4321");
  });

  it("hides other people's detections on detail fetch", async () => {
    const list = await api(ctx.app).get("/api/detections").set(bearer(authority.accessToken));
    const ids: string[] = list.body.items.map((d: { id: string }) => d.id);
    const owned = await api(ctx.app).get(`/api/detections/${ids[1]}`).set(bearer(user.accessToken));
    expect(owned.status).toBe(404);
    const mine = await api(ctx.app).get(`/api/detections/${ids[2]}`).set(bearer(user.accessToken));
    expect(mine.status).toBe(200);
  });

  it("requires authentication", async () => {
    expect((await api(ctx.app).get("/api/detections")).status).toBe(401);
  });
});

describe("detections actions", () => {
  let detectionId: string;

  beforeEach(async () => {
    const doc = await insertDetection(deviceId, {
      scaledSpeedKmh: 66,
      overspeed: true,
      severity: "high",
    });
    detectionId = doc.id;
  });

  it("lets authority review, tag and fine — and audits each action", async () => {
    const review = await api(ctx.app)
      .post(`/api/detections/${detectionId}/review`)
      .set(bearer(authority.accessToken))
      .send({ status: "confirmed", note: "clear violation" });
    expect(review.status).toBe(200);
    expect(review.body.detection.review.status).toBe("confirmed");
    expect(review.body.detection.review.by).toBe(authority.id);

    const tag = await api(ctx.app)
      .post(`/api/detections/${detectionId}/tag`)
      .set(bearer(authority.accessToken))
      .send({ plate: "mh 01 xy 9999" });
    expect(tag.status).toBe(200);
    expect(tag.body.detection.plate).toBe("MH 01 XY 9999");

    const fine = await api(ctx.app)
      .post(`/api/detections/${detectionId}/fine`)
      .set(bearer(authority.accessToken))
      .send({ amount: 500, status: "unpaid" });
    expect(fine.status).toBe(200);
    expect(fine.body.detection.fine).toEqual({ amount: 500, status: "unpaid" });

    const audits = await AuditLogModel.find({ entity: "detection" }).sort("at");
    expect(audits.map((a) => a.action)).toEqual([
      "detection.review",
      "detection.tag",
      "detection.fine",
    ]);
  });

  it("forbids the user role from review/tag/fine", async () => {
    for (const path of ["review", "tag", "fine"]) {
      const res = await api(ctx.app)
        .post(`/api/detections/${detectionId}/${path}`)
        .set(bearer(user.accessToken))
        .send(
          path === "review"
            ? { status: "confirmed" }
            : path === "tag"
              ? { plate: "AB 12 CD 3456" }
              : { amount: 100, status: "unpaid" }
        );
      expect(res.status).toBe(403);
    }
  });

  it("validates action bodies", async () => {
    const bad = await api(ctx.app)
      .post(`/api/detections/${detectionId}/review`)
      .set(bearer(authority.accessToken))
      .send({ status: "banana" });
    expect(bad.status).toBe(400);
    const badPlate = await api(ctx.app)
      .post(`/api/detections/${detectionId}/tag`)
      .set(bearer(authority.accessToken))
      .send({ plate: "!!!" });
    expect(badPlate.status).toBe(400);
  });

  it("404s on unknown detection ids", async () => {
    const res = await api(ctx.app)
      .post("/api/detections/000000000000000000000000/review")
      .set(bearer(authority.accessToken))
      .send({ status: "confirmed" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/detections/:id/frame/retry", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const retry = (id: string, token: string) =>
    api(ctx.app).post(`/api/detections/${id}/frame/retry`).set(bearer(token));

  it("re-requests capture for a failed overspeed frame and audits it", async () => {
    const doc = await insertDetection(deviceId, {
      overspeed: true,
      scaledSpeedKmh: 66,
      frameStatus: "failed",
    });

    const res = await retry(doc.id, admin.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.detection.frame.status).toBe("pending");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const stored = await Detection.findById(doc.id);
    expect(stored!.frame.status).toBe("pending");

    const audits = await AuditLogModel.find({ entity: "detection", action: "detection.frame.retry" });
    expect(audits).toHaveLength(1);
  });

  it("rejects when the frame is already stored", async () => {
    const doc = await insertDetection(deviceId, { overspeed: true, frameStatus: "ready" });
    const res = await retry(doc.id, admin.accessToken);
    expect(res.status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects while a capture is already in flight", async () => {
    const doc = await insertDetection(deviceId, { overspeed: true, frameStatus: "pending" });
    const res = await retry(doc.id, admin.accessToken);
    expect(res.status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects detections within the speed limit", async () => {
    const doc = await insertDetection(deviceId, { overspeed: false, frameStatus: "failed" });
    const res = await retry(doc.id, admin.accessToken);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain("only captured for overspeed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forbids the user role", async () => {
    const doc = await insertDetection(deviceId, { overspeed: true, frameStatus: "failed" });
    const res = await retry(doc.id, user.accessToken);
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("404s on unknown detection ids", async () => {
    const res = await retry("000000000000000000000000", admin.accessToken);
    expect(res.status).toBe(404);
  });
});
