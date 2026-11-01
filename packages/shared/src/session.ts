import { z } from "zod";
import { GeoPointSchema } from "./detection";

export const SessionStatusSchema = z.enum(["active", "completed"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  deviceName: z.string().optional(),
  bootId: z.string(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  location: GeoPointSchema,
  detectionCount: z.number().int().min(0),
  overspeedCount: z.number().int().min(0),
  maxSpeed: z.number().min(0),
  avgSpeed: z.number().min(0),
  status: SessionStatusSchema,
  /** duration in seconds — null when session is still active */
  duration: z.number().nullable(),
});
export type Session = z.infer<typeof SessionSchema>;

export const SessionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  deviceId: z.string().optional(),
  status: SessionStatusSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type SessionQuery = z.infer<typeof SessionQuerySchema>;

/** Socket payload when a new session starts */
export const SessionNewPayloadSchema = z.object({
  sessionId: z.string(),
  deviceId: z.string(),
  deviceName: z.string(),
  bootId: z.string(),
  startedAt: z.string().datetime(),
});
export type SessionNewPayload = z.infer<typeof SessionNewPayloadSchema>;

/** Socket payload on session stat update */
export const SessionUpdatedPayloadSchema = z.object({
  sessionId: z.string(),
  detectionCount: z.number().int().min(0),
  overspeedCount: z.number().int().min(0),
  maxSpeed: z.number().min(0),
  avgSpeed: z.number().min(0),
});
export type SessionUpdatedPayload = z.infer<typeof SessionUpdatedPayloadSchema>;
