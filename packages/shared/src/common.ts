import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const RoleSchema = z.enum(["admin", "authority", "user"]);
export type Role = z.infer<typeof RoleSchema>;

export const SeveritySchema = z.enum(["low", "medium", "high"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const DirectionSchema = z.enum(["fwd", "rev"]);
export type Direction = z.infer<typeof DirectionSchema>;

export const CameraStatusSchema = z.enum(["ok", "waiting", "offline"]);
export type CameraStatus = z.infer<typeof CameraStatusSchema>;

export const ReviewStatusSchema = z.enum(["pending", "confirmed", "dismissed"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const FrameStatusSchema = z.enum(["pending", "ready", "failed", "skipped"]);
export type FrameStatus = z.infer<typeof FrameStatusSchema>;

export const FineStatusSchema = z.enum(["unpaid", "paid", "waived"]);
export type FineStatus = z.infer<typeof FineStatusSchema>;

/** Provenance of a real IR gate reading transferred over USB serial. */
export const DetectionSourceSchema = z.literal("arduino");
export type DetectionSource = z.infer<typeof DetectionSourceSchema>;

export const HeartbeatSourceSchema = z.enum(["bridge", "vision"]);
export type HeartbeatSource = z.infer<typeof HeartbeatSourceSchema>;

export const HealthStatusSchema = z.enum(["online", "offline", "degraded", "waiting"]);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const DeviceStatusSchema = z.enum(["active", "maintenance", "disabled"]);
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;

/* ------------------------------------------------------------------ */
/* Physics (shared with firmware so the UI can verify values)          */
/* ------------------------------------------------------------------ */

/** Distance in metres between IR sensor A and IR sensor B. */
export const GATE_DISTANCE_M = 0.1;

/** speed_kmh = (0.1 / (dt_us * 1e-6)) * 3.6 = 360000 / dt_us */
export function speedKmhFromDtUs(dtUs: number): number {
  return 360000 / dtUs;
}

/** dt_us required for a given speed. */
export function dtUsFromSpeedKmh(speedKmh: number): number {
  return Math.round(360000 / speedKmh);
}

/** Percent over limit -> severity bucket (server-side rule). */
export function severityFor(scaledSpeedKmh: number, limitKmh: number): Severity {
  if (limitKmh <= 0) return "low";
  const over = ((scaledSpeedKmh - limitKmh) / limitKmh) * 100;
  if (over < 15) return "low";
  if (over < 40) return "medium";
  return "high";
}

export function applyScale(speedKmh: number, scaleFactor: number): number {
  return round1(speedKmh * scaleFactor);
}

/** Convert the dashboard limit into a raw gate threshold, rounded down for the MCU command. */
export function gateTripLimitKmh(speedLimitKmh: number, scaleFactor: number): number {
  const rawLimit = Math.floor((speedLimitKmh / scaleFactor) * 100) / 100;
  return Math.min(200, Math.max(0.1, rawLimit));
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* API error envelope                                                  */
/* ------------------------------------------------------------------ */

export const ErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INVALID_DEVICE_KEY",
  "DUPLICATE_DETECTION",
  "INTERNAL_ERROR",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export interface Paged<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Accepts "2025-01-31" or full ISO-8601 datetime. */
export const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/, {
    message: "expected ISO-8601 date or datetime",
  });
