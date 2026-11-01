import { z } from "zod";
import { CameraStatusSchema, HealthStatusSchema } from "./common";
import type { Detection } from "./detection";

/** Single source of truth for Socket.IO event names. */
export const SOCKET_EVENTS = {
  detectionNew: "detection:new",
  detectionFrame: "detection:frame",
  detectionUpdated: "detection:updated",
  systemStatus: "system:status",
  alertOverspeed: "alert:overspeed",
  deviceUpdated: "device:updated",
  /** server -> bridge: forward a command to the Arduino over serial */
  deviceCommand: "server:device-command",
  /** session lifecycle */
  sessionNew: "session:new",
  sessionUpdated: "session:updated",
} as const;
export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/* ---------------- payloads ---------------- */

export const ComponentStatusSchema = z.object({
  name: z.enum(["bridge", "vision", "server", "db"]),
  status: HealthStatusSchema,
  lastSeenAt: z.string().datetime().nullable(),
  detail: z.record(z.union([z.string(), z.number(), z.boolean()])).nullable(),
});
export type ComponentStatus = z.infer<typeof ComponentStatusSchema>;

export const SystemStatusSchema = z.object({
  components: z.array(ComponentStatusSchema),
  cameraStatus: CameraStatusSchema,
  emittedAt: z.string().datetime(),
});
export type SystemStatus = z.infer<typeof SystemStatusSchema>;

export const OverspeedAlertSchema = z.object({
  detectionId: z.string(),
  deviceId: z.string(),
  deviceName: z.string(),
  scaledSpeedKmh: z.number(),
  limitKmh: z.number(),
  severity: z.enum(["low", "medium", "high"]),
  plate: z.string().nullable(),
  at: z.string().datetime(),
});
export type OverspeedAlert = z.infer<typeof OverspeedAlertSchema>;

export const DetectionFrameSchema = z.object({
  detectionId: z.string(),
  status: z.enum(["pending", "ready", "failed"]),
  thumbUrl: z.string().nullable(),
  frameUrl: z.string().nullable(),
  capturedAt: z.string().datetime().nullable(),
});
export type DetectionFramePayload = z.infer<typeof DetectionFrameSchema>;

export const DeviceCommandPayloadSchema = z.object({
  deviceId: z.string(),
  command: z.discriminatedUnion("cmd", [
    z.object({
      cmd: z.literal("set_limit"),
      kmh: z.number().min(5).max(200),
      scale: z.number().min(0.01).max(1000).optional(),
    }),
    z.object({ cmd: z.literal("buzzer_test") }),
    z.object({ cmd: z.literal("ping") }),
  ]),
});
export type DeviceCommandPayload = z.infer<typeof DeviceCommandPayloadSchema>;

export type { Detection };
