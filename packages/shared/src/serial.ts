import { z } from "zod";
import { DirectionSchema, DetectionSourceSchema } from "./common";

/**
 * SERIAL PROTOCOL CONTRACT (single source of truth, 115200 baud, NDJSON).
 * Documented in /firmware/README.md and enforced by the physical serial bridge.
 *
 * Device -> bridge:
 *   {"t":"hello","fw":"1.0.0","limit":40.0,"boot":305419896}
 *   {"t":"detection","dt_us":8500,"speed_kmh":42.35,"dir":"fwd","over":true,
 *    "limit":40.0,"seq":17}
 *   {"t":"hb","seq":17}
 *   {"t":"ack","cmd":"set_limit"}
 * Debug lines start with "#" and are ignored by the bridge.
 *
 * Bridge -> device:
 *   {"cmd":"set_limit","kmh":6,"scale":10} | {"cmd":"buzzer_test"} | {"cmd":"ping"}
 *   (set_limit.scale is optional: the station scale factor, so the LCD can show
 *   the real-world equivalent speed = gate speed x scale)
 *
 * `boot` is a random uint32 generated at MCU reset; `seq` restarts at 0 for
 * each boot, so (bootId, seq) is the idempotency key.
 */

const BOOT_ID = z.number().int().min(0).max(4294967295);

export const SerialHelloSchema = z.object({
  t: z.literal("hello"),
  fw: z.string().min(1).max(32),
  limit: z.number().positive().max(200),
  boot: BOOT_ID,
});
export type SerialHello = z.infer<typeof SerialHelloSchema>;

export const SerialDetectionSchema = z.object({
  t: z.literal("detection"),
  dt_us: z.number().int().positive(),
  speed_kmh: z.number().positive().max(999),
  dir: DirectionSchema,
  over: z.boolean(),
  limit: z.number().positive().max(200),
  seq: z.number().int().min(0),
});
export type SerialDetection = z.infer<typeof SerialDetectionSchema>;

export const SerialHeartbeatSchema = z.object({
  t: z.literal("hb"),
  seq: z.number().int().min(0),
});
export type SerialHeartbeat = z.infer<typeof SerialHeartbeatSchema>;

export const SerialAckSchema = z.object({
  t: z.literal("ack"),
  cmd: z.string().min(1).max(40),
});
export type SerialAck = z.infer<typeof SerialAckSchema>;

export const SerialLineSchema = z.discriminatedUnion("t", [
  SerialHelloSchema,
  SerialDetectionSchema,
  SerialHeartbeatSchema,
  SerialAckSchema,
]);
export type SerialLine = z.infer<typeof SerialLineSchema>;

/* ---------------- bridge -> device commands ---------------- */

export const DeviceCommandSchema = z.discriminatedUnion("cmd", [
  z.object({
    cmd: z.literal("set_limit"),
    kmh: z.number().min(0.1).max(200),
    scale: z.number().min(0.01).max(1000).optional(),
  }),
  z.object({ cmd: z.literal("buzzer_test") }),
  z.object({ cmd: z.literal("ping") }),
]);
export type DeviceCommand = z.infer<typeof DeviceCommandSchema>;

export function serializeCommand(cmd: DeviceCommand): string {
  return JSON.stringify(cmd) + "\n";
}

/* ---------------- bridge -> server ingest body ---------------- */

export const IngestDetectionSchema = z.object({
  /** Serial `seq`, monotonic within a boot session. */
  seq: z.number().int().min(0),
  /** Serial `hello.boot` (uint32) as a string; synthesized if hello was missed. */
  bootId: z.string().min(1).max(64),
  dtMicros: z.number().int().positive(),
  /** Raw (unscaled) speed measured by the 10 cm gate. */
  measuredSpeedKmh: z.number().positive().max(999),
  /** Arduino-local overspeed decision; this is the condition that sounds the buzzer. */
  deviceOver: z.boolean(),
  direction: DirectionSchema,
  /** Limit the device applied locally (audit trail; server recomputes authoritatively). */
  deviceLimitKmh: z.number().positive().max(200).optional(),
  /** Mac clock ISO-8601 — the Arduino has no RTC. */
  receivedAt: z.string().datetime(),
  source: DetectionSourceSchema,
});
export type IngestDetection = z.infer<typeof IngestDetectionSchema>;

export const IngestAckSchema = z.object({
  id: z.string(),
  duplicate: z.boolean(),
});
export type IngestAck = z.infer<typeof IngestAckSchema>;
