import type { ComponentStatus, HealthStatus, SystemStatus } from "@smart-speed/shared";
import cron, { type ScheduledTask } from "node-cron";
import mongoose from "mongoose";
import { Device, Detection } from "../models";
import { toPublicDevice } from "../models";
import { logger } from "../logger";
import { sockets } from "./sockets";
import { closeInactiveSessions } from "./sessions";
import { notifyOverspeed } from "./whatsapp";

const HEARTBEAT_TIMEOUT_MS = 15_000;

interface ComponentState {
  status: HealthStatus;
  lastSeenAt: Date | null;
  detail: Record<string, string | number | boolean> | null;
}

const components = new Map<string, ComponentState>([
  ["bridge", { status: "offline", lastSeenAt: null, detail: null }],
  ["vision", { status: "offline", lastSeenAt: null, detail: null }],
  ["server", { status: "online", lastSeenAt: new Date(), detail: null }],
  ["db", { status: "offline", lastSeenAt: null, detail: null }],
]);

function toHealthStatus(raw: string): HealthStatus {
  if (raw === "ok" || raw === "connected") return "online";
  if (raw === "waiting") return "waiting";
  if (raw === "degraded") return "degraded";
  return "offline";
}

function cameraFromVision(state: ComponentState | undefined): "ok" | "waiting" | "offline" {
  if (state?.status === "online") return "ok";
  if (state?.status === "waiting" || state?.status === "degraded") return "waiting";
  return "offline";
}

export function buildSystemStatus(): SystemStatus {
  const vision = components.get("vision");
  return {
    components: [...components.entries()].map(([name, state]) => ({
      name: name as ComponentStatus["name"],
      status: state.status,
      lastSeenAt: state.lastSeenAt ? state.lastSeenAt.toISOString() : null,
      detail: state.detail,
    })),
    cameraStatus: cameraFromVision(vision),
    emittedAt: new Date().toISOString(),
  };
}

/** Records a bridge/vision heartbeat and refreshes the related device fields. */
export async function recordHeartbeat(input: {
  source: "bridge" | "vision";
  status: string;
  meta: Record<string, string | number | boolean>;
  deviceId?: string;
}): Promise<void> {
  const state = components.get(input.source);
  if (state) {
    state.status = toHealthStatus(input.status);
    state.lastSeenAt = new Date();
    state.detail = input.meta;
  }

  if (input.source === "bridge" && input.deviceId) {
    const fw = input.meta.fw;
    await Device.updateOne(
      { _id: input.deviceId },
      {
        $set: {
          lastSeenAt: new Date(),
          bridgeOnline: true,
          ...(typeof fw === "string" && fw.length > 0 && fw.length <= 64
            ? { firmwareVersion: fw }
            : {}),
        },
      }
    );
  }
  if (input.source === "vision") {
    const cameraStatus = cameraFromVision(components.get("vision"));
    await Device.updateMany({}, { $set: { cameraStatus } });
  }
  sockets.systemStatus(buildSystemStatus());
}

let statusTask: ScheduledTask | null = null;
let frameTask: ScheduledTask | null = null;
let lastStatusJson = "";

/**
 * Every 5 s: mark bridge/camera offline when no heartbeat arrived for 15 s,
 * refresh db/server health, and broadcast `system:status` only on change.
 */
function checkHeartbeats(): void {
  const now = Date.now();
  const stale = (seen: Date | null): boolean =>
    seen === null || now - seen.getTime() > HEARTBEAT_TIMEOUT_MS;

  const bridge = components.get("bridge")!;
  if (bridge.status !== "offline" && stale(bridge.lastSeenAt)) {
    bridge.status = "offline";
    bridge.detail = null;
    void Device.find({ bridgeOnline: true })
      .then((devices) =>
        Promise.all(
          devices.map(async (device) => {
            device.bridgeOnline = false;
            await device.save();
            sockets.deviceUpdated(toPublicDevice(device));
          })
        )
      )
      .catch((err: unknown) => logger.warn({ err }, "failed to mark bridge offline"));
  }

  const vision = components.get("vision")!;
  if (vision.status !== "offline" && stale(vision.lastSeenAt)) {
    vision.status = "offline";
    vision.detail = null;
    void Device.updateMany({ cameraStatus: { $ne: "offline" } }, { cameraStatus: "offline" }).catch(
      (err: unknown) => logger.warn({ err }, "failed to mark camera offline")
    );
  }

  const db = components.get("db")!;
  db.status = mongoose.connection.readyState === 1 ? "online" : "offline";
  db.lastSeenAt = db.status === "online" ? new Date() : db.lastSeenAt;
  components.get("server")!.lastSeenAt = new Date();

  const status = buildSystemStatus();
  const json = JSON.stringify(status);
  if (json !== lastStatusJson) {
    lastStatusJson = json;
    sockets.systemStatus(status);
  }
}

/** Frames that stayed `pending` longer than 60 s are failed (vision missing/stuck). */
async function failStaleFrames(): Promise<void> {
  const cutoff = new Date(Date.now() - 60_000);
  const stale = await Detection.find({
    "frame.status": "pending",
    receivedAt: { $lt: cutoff },
  })
    .select("id frame.status")
    .limit(500);
  for (const doc of stale) {
    doc.frame.status = "failed";
    await doc.save();
    notifyOverspeed(doc.id, null);
    sockets.detectionFrame({
      detectionId: doc.id,
      status: "failed",
      thumbUrl: null,
      frameUrl: null,
      capturedAt: null,
    });
  }
}

export function startWatchdogs(): void {
  statusTask = cron.schedule("*/5 * * * * *", () => checkHeartbeats());
  frameTask = cron.schedule("0 * * * * *", () => {
    void failStaleFrames().catch((err: unknown) => logger.warn({ err }, "frame watchdog failed"));
    void closeInactiveSessions().catch((err: unknown) =>
      logger.warn({ err }, "session watchdog failed")
    );
  });
  logger.info("watchdogs started (heartbeat 5s, frame sweep 60s, session close 60s)");
}

/**
 * Boot-time hygiene: a previous server run may have left `bridgeOnline`/
 * `cameraStatus` flags set. The heartbeat watchdog only marks devices offline
 * after it has seen a heartbeat, so stale flags would survive forever.
 */
export async function resetStaleDeviceFlags(): Promise<void> {
  try {
    const devices = await Device.find({
      $or: [{ bridgeOnline: true }, { cameraStatus: "ok" }],
    });
    for (const device of devices) {
      if (device.bridgeOnline) device.bridgeOnline = false;
      if (device.cameraStatus === "ok") device.cameraStatus = "offline";
      await device.save();
      sockets.deviceUpdated(toPublicDevice(device));
    }
    if (devices.length > 0) {
      logger.info({ count: devices.length }, "cleared stale device health flags from previous run");
    }
  } catch (err) {
    logger.warn({ err }, "failed to clear stale device health flags");
  }
}

export function stopWatchdogs(): void {
  statusTask?.stop();
  frameTask?.stop();
  statusTask = null;
  frameTask = null;
}

/** Test helper: forget recorded heartbeats. */
export function resetHealth(): void {
  for (const state of components.values()) {
    state.status = state.lastSeenAt ? "online" : "offline";
    state.detail = null;
  }
  components.get("bridge")!.lastSeenAt = null;
  components.get("vision")!.lastSeenAt = null;
  lastStatusJson = "";
}
