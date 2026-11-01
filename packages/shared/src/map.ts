import { z } from "zod";
import { ISO_DATE, type Severity } from "./common";

export const MapDetectionsQuerySchema = z.object({
  /** bbox as minLng,minLat,maxLng,maxLat */
  bbox: z
    .string()
    .regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/, "expected minLng,minLat,maxLng,maxLat")
    .optional(),
  from: ISO_DATE.optional(),
  to: ISO_DATE.optional(),
  overspeed: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  severity: z.enum(["low", "medium", "high"]).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});
export type MapDetectionsQuery = z.infer<typeof MapDetectionsQuerySchema>;

export const MapHeatQuerySchema = z.object({
  from: ISO_DATE.optional(),
  to: ISO_DATE.optional(),
  overspeed: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(20000).default(5000),
});
export type MapHeatQuery = z.infer<typeof MapHeatQuerySchema>;

export interface GeoJsonFeature<P = Record<string, unknown>> {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: P;
}

export interface GeoJsonFeatureCollection<P = Record<string, unknown>> {
  type: "FeatureCollection";
  features: GeoJsonFeature<P>[];
}

export interface MapDetectionProps {
  id: string;
  deviceId: string;
  deviceName: string;
  scaledSpeedKmh: number;
  limitKmh: number;
  overspeed: boolean;
  severity: Severity;
  detectedAt: string;
  plate: string | null;
  frameThumbUrl: string | null;
}

export interface HeatPoint {
  lng: number;
  lat: number;
  weight: number;
}

export interface DeviceMarker {
  id: string;
  name: string;
  lng: number;
  lat: number;
  bridgeOnline: boolean;
  cameraStatus: "ok" | "waiting" | "offline";
  speedLimitKmh: number;
  scaleFactor: number;
}
