import { z } from "zod";
import { CameraStatusSchema, DeviceStatusSchema } from "./common";

export const DeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  location: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number(), z.number()]), // [lng, lat]
  }),
  scaleFactor: z.number().positive().max(1000),
  speedLimitKmh: z.number().min(5).max(200),
  status: DeviceStatusSchema,
  lastSeenAt: z.string().datetime().nullable(),
  bridgeOnline: z.boolean(),
  cameraStatus: CameraStatusSchema,
  firmwareVersion: z.string().nullable(),
  /** Only present on create/rotate responses — shown to the admin exactly once. */
  apiKey: z.string().optional(),
  apiKeyPrefix: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const DeviceCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().max(200).optional(),
  location: z.object({
    coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  }),
  scaleFactor: z.number().positive().max(1000).default(1),
  speedLimitKmh: z.number().min(5).max(200).default(40),
  status: DeviceStatusSchema.default("active"),
});
export type DeviceCreate = z.infer<typeof DeviceCreateSchema>;

export const DeviceUpdateSchema = DeviceCreateSchema.partial();
export type DeviceUpdate = z.infer<typeof DeviceUpdateSchema>;

export const DeviceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().max(80).optional(),
  status: DeviceStatusSchema.optional(),
});
export type DeviceQuery = z.infer<typeof DeviceQuerySchema>;

/* ---------------- heartbeat ---------------- */

export const HeartbeatSchema = z.object({
  source: z.enum(["bridge", "vision"]),
  status: z.string().min(1).max(40),
  meta: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  at: z.string().datetime().optional(),
});
export type Heartbeat = z.infer<typeof HeartbeatSchema>;
