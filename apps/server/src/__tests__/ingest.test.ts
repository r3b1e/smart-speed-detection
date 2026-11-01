import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisteredUser, TestCtx } from "./helpers";
import {
  TINY_JPEG,
  api,
  clearDb,
  createDevice,
  createUserWithRole,
  setupCtx,
  teardownCtx,
} from "./helpers";
import { config } from "../config";
import { Detection, Device } from "../models";

let ctx: TestCtx;
let admin: RegisteredUser;
let apiKey: string;
let deviceId: string;
let fetchSpy: ReturnType<typeof vi.spyOn>;

/** Vision answers "ok" without touching the network, so capture stays deterministic. */
const captureOk = () =>
  new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeAll(async () => {
  ctx = await setupCtx();
});

afterAll(async () => {
  await teardownCtx(ctx);
});

beforeEach(async () => {
  await clearDb();
  admin = await createUserWithRole(ctx.app, "admin");
  const created = await createDevice(ctx.app, admin.accessToken, "Ingest Gate");
  apiKey = created.apiKey;
  deviceId = created.device.id;
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(captureOk());
});

afterEach(() => {
  fetchSpy.mockRestore();
});

const payload = (over: Record<string, unknown> = {}) => ({
  seq: 1,
  bootId: "305419896",
  dtMicros: 8500,
  measuredSpeedKmh: 42.4,
  deviceOver: true,
  direction: "fwd",
  deviceLimitKmh: 40,
  receivedAt: new Date().toISOString(),
  source: "arduino",
  ...over,
});

const postIngest = (body: unknown, key = apiKey) =>
  api(ctx.app).post("/api/ingest/detections").set("x-device-key", key).send(body);

describe("POST /api/ingest/detections", () => {
  it("stores a detection with server-authoritative limit, scaling and severity", async () => {
    const res = await postIngest(payload());
    expect(res.status).toBe(201);
    expect(res.body.duplicate).toBe(false);
    expect(res.body.id).toBeTruthy();

    const doc = await Detection.findById(res.body.id);
    expect(doc).toBeTruthy();
    expect(doc!.source).toBe("arduino");
    expect(doc!.limitKmh).toBe(40);
    expect(doc!.scaledSpeedKmh).toBeCloseTo(42.4, 1);
    expect(doc!.overspeed).toBe(true);
    expect(doc!.severity).toBe("low"); // +6% over limit
    expect(doc!.direction).toBe("fwd");
    expect(doc!.dtMicros).toBe(8500);
    expect(doc!.frame.status).toBe("pending");
    expect(doc!.plate).toBeNull();
    expect(doc!.review.status).toBe("pending");
    expect(doc!.location.coordinates).toEqual([72.8777, 19.076]);
    expect(doc!.vehicleUid).toBeTruthy();
  });

  it("honours the station scale factor and flags severity by percent over", async () => {
    await Device.findByIdAndUpdate(deviceId, { scaleFactor: 5 });
    const fast = await postIngest(payload({ measuredSpeedKmh: 15, seq: 10 }));
    expect(fast.status).toBe(201);
    const doc = await Detection.findById(fast.body.id);
    expect(doc!.scaledSpeedKmh).toBe(75);
    expect(doc!.overspeed).toBe(true);
    expect(doc!.severity).toBe("high"); // +87.5%

    const slow = await postIngest(payload({ measuredSpeedKmh: 3, seq: 11 }));
    const slowDoc = await Detection.findById(slow.body.id);
    expect(slowDoc!.scaledSpeedKmh).toBe(15);
    expect(slowDoc!.overspeed).toBe(false);
  });

  it("skips camera capture for detections within the speed limit", async () => {
    const res = await postIngest(payload({ measuredSpeedKmh: 20, deviceOver: false }));
    expect(res.status).toBe(201);
    const doc = await Detection.findById(res.body.id);
    expect(doc!.overspeed).toBe(false);
    expect(doc!.frame.status).toBe("skipped");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("captures when the server flags overspeed even if the Arduino buzzer stayed silent", async () => {
    await Device.findByIdAndUpdate(deviceId, { scaleFactor: 5 });
    const res = await postIngest(payload({ measuredSpeedKmh: 15, deviceOver: false }));
    expect(res.status).toBe(201);
    const doc = await Detection.findById(res.body.id);
    expect(doc!.overspeed).toBe(true);
    expect(doc!.deviceOver).toBe(false);
    expect(doc!.frame.status).toBe("pending");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("marks the frame failed when vision reports no capture", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ status: "failed", reason: "no frame within window" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const res = await postIngest(payload());
    expect(res.status).toBe(201);
    await vi.waitFor(() => {
      return Detection.findById(res.body.id).then((doc) => {
        expect(doc!.frame.status).toBe("failed");
      });
    });
  });

  it("deduplicates on (deviceId, bootId, seq)", async () => {
    const first = await postIngest(payload({ seq: 7 }));
    const second = await postIngest(payload({ seq: 7, measuredSpeedKmh: 10 }));
    expect(second.status).toBe(201);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.id).toBe(first.body.id);
    expect(await Detection.countDocuments()).toBe(1);
  });

  it("accepts a batch and acks each item", async () => {
    const res = await postIngest([payload({ seq: 1 }), payload({ seq: 2, measuredSpeedKmh: 12 })]);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.every((i: { duplicate: boolean }) => i.duplicate === false)).toBe(true);
    expect(await Detection.countDocuments()).toBe(2);
  });

  it("marks the station online and stamps lastSeenAt", async () => {
    await postIngest(payload());
    const device = await Device.findById(deviceId);
    expect(device!.bridgeOnline).toBe(true);
    expect(device!.lastSeenAt).toBeTruthy();
  });

  it("rejects an unknown or missing device key", async () => {
    const bad = await postIngest(payload(), "ssd_000000000000000000000000000000000000000000000000");
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("INVALID_DEVICE_KEY");
    const missing = await api(ctx.app).post("/api/ingest/detections").send(payload());
    expect(missing.status).toBe(401);
  });

  it("rejects malformed payloads with VALIDATION_ERROR", async () => {
    const res = await postIngest(payload({ dtMicros: -1, source: "magic" }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await Detection.countDocuments()).toBe(0);
  });
});

describe("POST /api/ingest/heartbeat", () => {
  it("records a bridge heartbeat with the device firmware version", async () => {
    const res = await api(ctx.app)
      .post("/api/ingest/heartbeat")
      .set("x-device-key", apiKey)
      .send({
        source: "bridge",
        status: "ok",
        meta: { serialConnected: true, queueDepth: 0, fw: "1.0.0" },
      });
    expect(res.status).toBe(204);
    const device = await Device.findById(deviceId);
    expect(device!.bridgeOnline).toBe(true);
    expect(device!.lastSeenAt).toBeTruthy();
    expect(device!.firmwareVersion).toBe("1.0.0");
  });

  it("ignores an empty or oversized firmware version", async () => {
    await api(ctx.app)
      .post("/api/ingest/heartbeat")
      .set("x-device-key", apiKey)
      .send({ source: "bridge", status: "ok", meta: { fw: "" } });
    await api(ctx.app)
      .post("/api/ingest/heartbeat")
      .set("x-device-key", apiKey)
      .send({ source: "bridge", status: "ok", meta: { fw: "x".repeat(65) } });
    let device = await Device.findById(deviceId);
    expect(device!.firmwareVersion).toBeFalsy();

    await api(ctx.app)
      .post("/api/ingest/heartbeat")
      .set("x-device-key", apiKey)
      .send({ source: "bridge", status: "ok", meta: { fw: "2.1.0" } });
    device = await Device.findById(deviceId);
    expect(device!.firmwareVersion).toBe("2.1.0");
  });

  it("records a vision heartbeat and updates camera status", async () => {
    const res = await api(ctx.app)
      .post("/api/ingest/heartbeat")
      .set("x-vision-secret", config.VISION_SHARED_SECRET)
      .send({ source: "vision", status: "ok", meta: { camera: "iPhone" } });
    expect(res.status).toBe(204);
    const device = await Device.findById(deviceId);
    expect(device!.cameraStatus).toBe("ok");
  });

  it("rejects a wrong vision secret", async () => {
    const res = await api(ctx.app)
      .post("/api/ingest/heartbeat")
      .set("x-vision-secret", "wrong-secret")
      .send({ source: "vision", status: "ok" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/ingest/detections/:id/frame", () => {
  it("stores JPEG frame + thumb and marks the detection ready", async () => {
    const ingested = await postIngest(payload({ seq: 42 }));
    const id = ingested.body.id as string;

    const res = await api(ctx.app)
      .post(`/api/ingest/detections/${id}/frame`)
      .set("x-vision-secret", config.VISION_SHARED_SECRET)
      .attach("frame", TINY_JPEG, { contentType: "image/jpeg", filename: "frame.jpg" })
      .attach("thumb", TINY_JPEG, { contentType: "image/jpeg", filename: "thumb.jpg" });
    expect(res.status).toBe(201);
    expect(res.body.fileId).toBeTruthy();
    expect(res.body.thumbFileId).toBeTruthy();

    const doc = await Detection.findById(id);
    expect(doc!.frame.status).toBe("ready");
    expect(doc!.frame.fileId).toBeTruthy();
    expect(doc!.frame.capturedAt).toBeTruthy();

    const stream = await api(ctx.app)
      .get(`/api/frames/${res.body.fileId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(stream.status).toBe(200);
    expect(stream.headers["content-type"]).toContain("image/jpeg");
    expect(Buffer.byteLength(stream.body as unknown as Buffer)).toBe(TINY_JPEG.length);
  });

  it("rejects non-JPEG uploads", async () => {
    const ingested = await postIngest(payload({ seq: 43 }));
    const res = await api(ctx.app)
      .post(`/api/ingest/detections/${ingested.body.id}/frame`)
      .set("x-vision-secret", config.VISION_SHARED_SECRET)
      .attach("frame", TINY_JPEG, { contentType: "image/png", filename: "frame.png" });
    expect(res.status).toBe(415);
  });

  it("rejects frame uploads for detections within the speed limit", async () => {
    const ingested = await postIngest(payload({ seq: 44, measuredSpeedKmh: 20 }));
    const res = await api(ctx.app)
      .post(`/api/ingest/detections/${ingested.body.id}/frame`)
      .set("x-vision-secret", config.VISION_SHARED_SECRET)
      .attach("frame", TINY_JPEG, { contentType: "image/jpeg", filename: "frame.jpg" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain("only accepted for overspeed");
  });

  it("404s for an unknown detection", async () => {
    const res = await api(ctx.app)
      .post("/api/ingest/detections/000000000000000000000000/frame")
      .set("x-vision-secret", config.VISION_SHARED_SECRET)
      .attach("frame", TINY_JPEG, { contentType: "image/jpeg", filename: "f.jpg" });
    expect(res.status).toBe(404);
  });
});
