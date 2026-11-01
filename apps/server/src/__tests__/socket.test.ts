import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
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
import { closeSocket, initSocket } from "../services/sockets";

let ctx: TestCtx;
let admin: RegisteredUser;
let user: RegisteredUser;
let httpServer: Server;
let port: number;
let apiKey: string;
let fetchSpy: ReturnType<typeof vi.spyOn>;
const clients: ClientSocket[] = [];

beforeAll(async () => {
  ctx = await setupCtx();
  httpServer = createServer(ctx.app);
  initSocket(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  port = (httpServer.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  closeSocket();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await teardownCtx(ctx);
});

beforeEach(async () => {
  await clearDb();
  admin = await createUserWithRole(ctx.app, "admin");
  user = await createUserWithRole(ctx.app, "user");
  const created = await createDevice(ctx.app, admin.accessToken, "Socket Gate");
  apiKey = created.apiKey;
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

function connect(opts: { token?: string; deviceKey?: string } = {}): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s = ioc(`http://localhost:${port}`, {
      auth: { token: opts.token, deviceKey: opts.deviceKey },
      reconnection: false,
      timeout: 5000,
    });
    const timer = setTimeout(() => reject(new Error("socket connect timeout")), 5000);
    s.on("connect", () => {
      clearTimeout(timer);
      clients.push(s);
      resolve(s);
    });
    s.on("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitFor<T>(socket: ClientSocket, event: string, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const ingest = (body: Record<string, unknown>) =>
  api(ctx.app).post("/api/ingest/detections").set("x-device-key", apiKey).send(body);

describe("socket.io auth", () => {
  it("accepts a valid user token", async () => {
    const socket = await connect({ token: user.accessToken });
    expect(socket.connected).toBe(true);
  });

  it("rejects a missing credential", async () => {
    await expect(connect()).rejects.toThrow();
  });

  it("rejects a garbage token", async () => {
    await expect(connect({ token: "not.a.jwt" })).rejects.toThrow();
  });

  it("accepts a valid device key", async () => {
    const socket = await connect({ deviceKey: apiKey });
    expect(socket.connected).toBe(true);
  });
});

describe("socket.io live events", () => {
  it("streams detection:new to connected authority clients", async () => {
    const socket = await connect({ token: admin.accessToken });
    const next = waitFor<{ id: string; overspeed: boolean }>(socket, "detection:new");
    const res = await ingest({
      seq: 1,
      bootId: "305419896",
      dtMicros: 8500,
      measuredSpeedKmh: 42.4,
      deviceOver: true,
      direction: "fwd",
      deviceLimitKmh: 40,
      receivedAt: new Date().toISOString(),
      source: "arduino",
    });
    expect(res.status).toBe(201);
    const payload = await next;
    expect(payload.id).toBe(res.body.id);
    expect(payload.overspeed).toBe(true);
  });

  it("emits alert:overspeed for violations only", async () => {
    const socket = await connect({ token: admin.accessToken });
    const alert = waitFor<{ detectionId: string; severity: string }>(socket, "alert:overspeed");

    const over = await ingest({
      seq: 2,
      bootId: "305419896",
      dtMicros: 8500,
      measuredSpeedKmh: 42.4,
      deviceOver: true,
      direction: "fwd",
      deviceLimitKmh: 40,
      receivedAt: new Date().toISOString(),
      source: "arduino",
    });
    const payload = await alert;
    expect(payload.detectionId).toBe(over.body.id);
    expect(payload.severity).toBe("low");

    // non-violation: wait briefly and assert no alert arrives
    const quiet = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 400);
      socket.once("alert:overspeed", () => {
        clearTimeout(timer);
        reject(new Error("unexpected overspeed alert"));
      });
    });
    await ingest({
      seq: 3,
      bootId: "305419896",
      dtMicros: 360000,
      measuredSpeedKmh: 10,
      deviceOver: false,
      direction: "fwd",
      deviceLimitKmh: 40,
      receivedAt: new Date().toISOString(),
      source: "arduino",
    });
    await quiet;
  });

  it("pushes system:status after a heartbeat", async () => {
    const socket = await connect({ token: admin.accessToken });
    const status = waitFor<{ components: { name: string; status: string }[]; emittedAt: string }>(
      socket,
      "system:status"
    );
    await api(ctx.app)
      .post("/api/ingest/heartbeat")
      .set("x-device-key", apiKey)
      .send({ source: "bridge", status: "ok", meta: { serialConnected: true, queueDepth: 0 } });
    const payload = await status;
    expect(payload.emittedAt).toBeTruthy();
    const bridge = payload.components.find((c) => c.name === "bridge");
    expect(bridge?.status).toBe("online");
  });

  it("broadcasts detection:frame after a frame upload", async () => {
    const socket = await connect({ token: admin.accessToken });
    const res = await ingest({
      seq: 9,
      bootId: "305419896",
      dtMicros: 8500,
      measuredSpeedKmh: 42.4,
      deviceOver: true,
      direction: "fwd",
      deviceLimitKmh: 40,
      receivedAt: new Date().toISOString(),
      source: "arduino",
    });
    const frameEvent = waitFor<{ detectionId: string; status: string; frameUrl: string | null }>(
      socket,
      "detection:frame"
    );
    const upload = await api(ctx.app)
      .post(`/api/ingest/detections/${res.body.id}/frame`)
      .set("x-vision-secret", config.VISION_SHARED_SECRET)
      .attach("frame", TINY_JPEG, { contentType: "image/jpeg", filename: "f.jpg" })
      .attach("thumb", TINY_JPEG, { contentType: "image/jpeg", filename: "t.jpg" });
    expect(upload.status).toBe(201);
    const payload = await frameEvent;
    expect(payload.detectionId).toBe(res.body.id);
    expect(payload.status).toBe("ready");
    expect(payload.frameUrl).toContain("/api/frames/");
  });
});
