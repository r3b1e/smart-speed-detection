import type { Detection, OverspeedAlert } from "@smart-speed/shared";
import { SOCKET_EVENTS } from "@smart-speed/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tryRefresh } from "../lib/api";
import { getAccessToken } from "../lib/session";
import { useLive } from "./live";

const fake = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  const socket = {
    handlers,
    connected: false,
    auth: undefined as Record<string, string> | undefined,
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
    }),
    connect: vi.fn(() => {
      socket.connected = true;
    }),
    disconnect: vi.fn(() => {
      socket.connected = false;
    }),
    removeAllListeners: vi.fn(() => {
      handlers.clear();
    }),
    fire: (event: string, payload?: unknown) => {
      handlers.get(event)?.(payload);
    },
  };
  return { socket };
});

vi.mock("socket.io-client", () => ({ io: vi.fn(() => fake.socket) }));
vi.mock("../lib/session", () => ({
  getAccessToken: vi.fn(() => "tok-1"),
  setAccessToken: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
}));
vi.mock("../lib/api", () => ({ tryRefresh: vi.fn() }));

function mockDetection(overrides: Partial<Detection> = {}): Detection {
  return {
    id: "det-1",
    deviceId: "dev-1",
    seq: 1,
    bootId: "boot-1",
    vehicleUid: "v-1",
    measuredSpeedKmh: 60,
    scaledSpeedKmh: 60,
    limitKmh: 40,
    overspeed: true,
    deviceOver: true,
    severity: "medium",
    direction: "fwd",
    dtMicros: 100000,
    detectedAt: "2026-10-07T10:00:00Z",
    receivedAt: "2026-10-07T10:00:00Z",
    location: { type: "Point", coordinates: [72.5, 19.1] },
    source: "arduino",
    frame: { fileId: null, thumbFileId: null, capturedAt: null, status: "pending" },
    plate: null,
    review: { status: "pending", by: null, at: null, note: null },
    fine: null,
    ...overrides,
  };
}

function mockAlert(overrides: Partial<OverspeedAlert> = {}): OverspeedAlert {
  return {
    detectionId: "det-1",
    deviceId: "dev-1",
    deviceName: "Gate A",
    scaledSpeedKmh: 80,
    limitKmh: 40,
    severity: "medium",
    plate: null,
    at: "2026-10-07T10:00:00Z",
    ...overrides,
  };
}

describe("live store", () => {
  beforeEach(() => {
    // disconnect() also wipes module-level listeners + socket reference.
    useLive.getState().disconnect();
    vi.clearAllMocks();
    vi.mocked(getAccessToken).mockReturnValue("tok-1");
    vi.mocked(tryRefresh).mockResolvedValue("new-tok");
  });

  it("does nothing when there is no access token", () => {
    vi.mocked(getAccessToken).mockReturnValue(null);
    useLive.getState().connect();
    expect(useLive.getState().status).toBe("idle");
  });

  it("connects with the token and reports live status", () => {
    useLive.getState().connect();
    expect(fake.socket.connected).toBe(false);
    expect(fake.socket.handlers.get("connect")).toBeDefined();
    fake.socket.fire("connect");
    expect(useLive.getState().status).toBe("connected");
  });

  it("records a live detection", () => {
    useLive.getState().connect();
    fake.socket.fire(SOCKET_EVENTS.detectionNew, mockDetection({ id: "d1" }));
    expect(useLive.getState().recent).toHaveLength(1);
    expect(useLive.getState().latest?.id).toBe("d1");
  });

  it("filters incoming detections by plate scope", () => {
    useLive.setState({ plateScope: ["ABC123"] });
    useLive.getState().connect();
    fake.socket.fire(SOCKET_EVENTS.detectionNew, mockDetection({ id: "out", plate: "ZZZ999" }));
    expect(useLive.getState().recent).toHaveLength(0);
    fake.socket.fire(SOCKET_EVENTS.detectionNew, mockDetection({ id: "in", plate: "ABC123" }));
    expect(useLive.getState().recent).toHaveLength(1);
    expect(useLive.getState().latest?.id).toBe("in");
  });

  it("increments alertSeq on each overspeed alert and respects scope", () => {
    useLive.getState().connect();
    fake.socket.fire(SOCKET_EVENTS.alertOverspeed, mockAlert());
    expect(useLive.getState().lastAlert?.detectionId).toBe("det-1");
    expect(useLive.getState().alertSeq).toBe(1);

    useLive.setState({ plateScope: ["ABC123"] });
    fake.socket.fire(SOCKET_EVENTS.alertOverspeed, mockAlert({ plate: "QQQ" }));
    expect(useLive.getState().alertSeq).toBe(1);
    fake.socket.fire(SOCKET_EVENTS.alertOverspeed, mockAlert({ plate: "ABC123" }));
    expect(useLive.getState().alertSeq).toBe(2);
  });

  it("refreshes the token on an auth connect_error and reconnects", async () => {
    useLive.getState().connect();
    fake.socket.fire("connect_error", Object.assign(new Error("invalid token")));
    await vi.waitFor(() => expect(fake.socket.auth?.token).toBe("new-tok"));
    expect(fake.socket.connected).toBe(true);
  });

  it("disconnect clears state, listeners and the socket", () => {
    useLive.getState().connect();
    fake.socket.fire("connect");
    useLive.getState().disconnect();
    expect(fake.socket.handlers.size).toBe(0);
    expect(useLive.getState().status).toBe("idle");
    expect(useLive.getState().recent).toHaveLength(0);
    expect(useLive.getState().system).toBeNull();
  });

  it("applies detection:frame updates to frames and recent entries", () => {
    useLive.getState().connect();
    fake.socket.fire(SOCKET_EVENTS.detectionNew, mockDetection({ id: "d1" }));
    fake.socket.fire(SOCKET_EVENTS.detectionFrame, {
      detectionId: "d1",
      status: "ready",
      thumbUrl: "/frames/t",
      frameUrl: "/frames/f",
      capturedAt: "2026-10-07T10:00:01Z",
    });
    expect(useLive.getState().frames["d1"]?.status).toBe("ready");
    expect(useLive.getState().recent[0]?.frame.status).toBe("ready");
  });
});
