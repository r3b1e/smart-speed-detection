import { z } from "zod";
import {
  DirectionSchema,
  FrameStatusSchema,
  ISO_DATE,
  ReviewStatusSchema,
  SeveritySchema,
  FineStatusSchema,
  DetectionSourceSchema,
  type Severity,
} from "./common";

/* ------------------------------------------------------------------ */
/* Detection entity (API representation)                               */
/* ------------------------------------------------------------------ */

export const GeoPointSchema = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([z.number(), z.number()]), // [lng, lat]
});
export type GeoPoint = z.infer<typeof GeoPointSchema>;

export const FrameInfoSchema = z.object({
  fileId: z.string().nullable(),
  thumbFileId: z.string().nullable(),
  capturedAt: z.string().datetime().nullable(),
  status: FrameStatusSchema,
});
export type FrameInfo = z.infer<typeof FrameInfoSchema>;

export const ReviewInfoSchema = z.object({
  status: ReviewStatusSchema,
  by: z.string().nullable(),
  at: z.string().datetime().nullable(),
  note: z.string().nullable(),
});
export type ReviewInfo = z.infer<typeof ReviewInfoSchema>;

export const FineInfoSchema = z.object({
  amount: z.number().min(0),
  status: FineStatusSchema,
});
export type FineInfo = z.infer<typeof FineInfoSchema>;

export const DetectionSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  deviceName: z.string().optional(),
  seq: z.number().int(),
  bootId: z.string(),
  vehicleUid: z.string(),
  measuredSpeedKmh: z.number(),
  scaledSpeedKmh: z.number(),
  limitKmh: z.number(),
  overspeed: z.boolean(),
  deviceOver: z.boolean(),
  severity: SeveritySchema,
  direction: DirectionSchema,
  dtMicros: z.number().int(),
  detectedAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  location: GeoPointSchema,
  source: DetectionSourceSchema,
  frame: FrameInfoSchema,
  plate: z.string().nullable(),
  review: ReviewInfoSchema,
  fine: FineInfoSchema.nullable(),
});
export type Detection = z.infer<typeof DetectionSchema>;

/* ------------------------------------------------------------------ */
/* List query                                                          */
/* ------------------------------------------------------------------ */

export const DetectionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  from: ISO_DATE.optional(),
  to: ISO_DATE.optional(),
  deviceId: z.string().optional(),
  overspeed: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  severity: SeveritySchema.optional(),
  review: ReviewStatusSchema.optional(),
  direction: DirectionSchema.optional(),
  minSpeed: z.coerce.number().min(0).optional(),
  maxSpeed: z.coerce.number().min(0).optional(),
  plate: z.string().max(32).optional(),
  q: z.string().max(120).optional(),
  sort: z
    .enum(["detectedAt", "-detectedAt", "scaledSpeedKmh", "-scaledSpeedKmh"])
    .default("-detectedAt"),
});
export type DetectionQuery = z.infer<typeof DetectionQuerySchema>;

/* ------------------------------------------------------------------ */
/* Authority actions                                                   */
/* ------------------------------------------------------------------ */

export const ReviewActionSchema = z.object({
  status: z.enum(["confirmed", "dismissed", "pending"]),
  note: z.string().max(500).optional(),
});
export type ReviewAction = z.infer<typeof ReviewActionSchema>;

export const TagPlateSchema = z.object({
  plate: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(32)
    .regex(/^[A-Z0-9 -]+$/, "plate may contain letters, numbers, spaces, dashes"),
});
export type TagPlate = z.infer<typeof TagPlateSchema>;

export const FineActionSchema = z.object({
  amount: z.number().min(0).max(100000),
  status: z.enum(["unpaid", "paid", "waived"]),
});
export type FineAction = z.infer<typeof FineActionSchema>;

/* ------------------------------------------------------------------ */
/* Analytics response shapes (typed UI + server share these)           */
/* ------------------------------------------------------------------ */

export const SummaryPeriodSchema = z.enum(["today", "7d", "30d"]);
export type SummaryPeriod = z.infer<typeof SummaryPeriodSchema>;

export interface TrendPoint {
  value: number;
  /** percent change vs previous equal-length period, null when no baseline */
  deltaPct: number | null;
}

export interface AnalyticsSummary {
  period: SummaryPeriod;
  total: TrendPoint;
  overspeed: TrendPoint;
  avgSpeedKmh: TrendPoint;
  maxSpeedKmh: number;
  violationRate: number;
  generatedAt: string;
}

export type TimeseriesBucket = "minute" | "hour" | "day";

export interface TimeseriesPoint {
  t: string;
  total: number;
  overspeed: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
}

export interface TimeseriesResponse {
  bucket: TimeseriesBucket;
  points: TimeseriesPoint[];
}

export interface HeatmapResponse {
  /** matrix[dow][hour]; dow 0 = Sunday (Mongo $isoDayOfWeek - 1) */
  matrix: number[][];
  overspeedMatrix: number[][];
  maxCount: number;
}

export interface DistributionBucket {
  from: number;
  to: number;
  count: number;
  overspeed: number;
}

export interface SpeedDistributionResponse {
  buckets: DistributionBucket[];
  unit: "km/h";
}

export interface ByDeviceRow {
  deviceId: string;
  name: string;
  total: number;
  overspeed: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  violationRate: number;
}

export interface ByDeviceResponse {
  rows: ByDeviceRow[];
}

export interface TopViolationRow {
  detectionId: string;
  deviceId: string;
  deviceName: string;
  plate: string | null;
  scaledSpeedKmh: number;
  limitKmh: number;
  overspeedByPct: number;
  severity: Severity;
  detectedAt: string;
}

export interface TopViolationsResponse {
  rows: TopViolationRow[];
}
