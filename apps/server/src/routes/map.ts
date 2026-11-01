import {
  MapDetectionsQuerySchema,
  MapHeatQuerySchema,
  type DeviceMarker,
  type GeoJsonFeature,
  type GeoJsonFeatureCollection,
  type HeatPoint,
  type MapDetectionProps,
} from "@smart-speed/shared";
import { Router } from "express";
import { ah } from "../errors";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Device, Detection, type IDetection } from "../models";
import { plateScope, rangeEnd, rangeStart } from "../services/scope";
import type { FilterQuery } from "mongoose";

export const mapRouter = Router();
mapRouter.use(requireAuth);

function bboxFilter(bbox: string): FilterQuery<IDetection> {
  const [minLng, minLat, maxLng, maxLat] = bbox.split(",").map(Number);
  return {
    location: {
      $geoWithin: {
        $geometry: {
          type: "Polygon",
          coordinates: [
            [
              [minLng, minLat],
              [maxLng, minLat],
              [maxLng, maxLat],
              [minLng, maxLat],
              [minLng, minLat],
            ],
          ],
        },
      },
    },
  };
}

async function detectionFilter(
  req: Parameters<typeof plateScope>[0],
  q: { from?: string; to?: string; overspeed?: boolean; severity?: "low" | "medium" | "high" }
): Promise<FilterQuery<IDetection>> {
  const filter: FilterQuery<IDetection> = { source: "arduino" };
  const from = rangeStart(q.from);
  const to = rangeEnd(q.to);
  if (from || to) {
    filter.detectedAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  }
  if (q.overspeed !== undefined) filter.overspeed = q.overspeed;
  if (q.severity) filter.severity = q.severity;
  const scope = await plateScope(req);
  if (scope) filter.$and = [scope];
  return filter;
}

mapRouter.get(
  "/detections",
  validate({ query: MapDetectionsQuerySchema }),
  ah(async (req, res) => {
    const q = req.query as unknown as {
      bbox?: string;
      from?: string;
      to?: string;
      overspeed?: boolean;
      severity?: "low" | "medium" | "high";
      limit: number;
    };
    const filter = await detectionFilter(req, q);
    if (q.bbox) Object.assign(filter, bboxFilter(q.bbox));
    const rows = await Detection.find(filter)
      .sort({ detectedAt: -1 })
      .limit(q.limit)
      .select(
        "deviceId location.coordinates scaledSpeedKmh limitKmh overspeed severity detectedAt plate frame.thumbFileId"
      );
    const devices = await Device.find({ _id: { $in: rows.map((r) => r.deviceId) } }).select("name");
    const names = new Map(devices.map((d) => [d.id, d.name]));

    const features: GeoJsonFeature<MapDetectionProps>[] = rows.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [...r.location.coordinates] as [number, number] },
      properties: {
        id: r.id,
        deviceId: r.deviceId.toString(),
        deviceName: names.get(r.deviceId.toString()) ?? "unknown station",
        scaledSpeedKmh: r.scaledSpeedKmh,
        limitKmh: r.limitKmh,
        overspeed: r.overspeed,
        severity: r.severity,
        detectedAt: r.detectedAt.toISOString(),
        plate: r.plate,
        frameThumbUrl: r.frame.thumbFileId ? `/api/frames/${r.frame.thumbFileId.toString()}` : null,
      },
    }));
    const collection: GeoJsonFeatureCollection<MapDetectionProps> = {
      type: "FeatureCollection",
      features,
    };
    res.json(collection);
  })
);

mapRouter.get(
  "/heat",
  validate({ query: MapHeatQuerySchema }),
  ah(async (req, res) => {
    const q = req.query as unknown as {
      from?: string;
      to?: string;
      overspeed?: boolean;
      severity?: "low" | "medium" | "high";
      limit: number;
    };
    const filter = await detectionFilter(req, q);
    const rows = await Detection.find(filter)
      .sort({ detectedAt: -1 })
      .limit(q.limit)
      .select("location.coordinates scaledSpeedKmh");
    const points: HeatPoint[] = rows.map((r) => ({
      lng: r.location.coordinates[0],
      lat: r.location.coordinates[1],
      weight: r.scaledSpeedKmh,
    }));
    res.json({ points });
  })
);

mapRouter.get(
  "/devices",
  ah(async (_req, res) => {
    const devices = await Device.find({ status: { $ne: "disabled" } }).select(
      "name location bridgeOnline cameraStatus speedLimitKmh scaleFactor"
    );
    const markers: DeviceMarker[] = devices.map((d) => ({
      id: d.id,
      name: d.name,
      lng: d.location.coordinates[0],
      lat: d.location.coordinates[1],
      bridgeOnline: d.bridgeOnline,
      cameraStatus: d.cameraStatus,
      speedLimitKmh: d.speedLimitKmh,
      scaleFactor: d.scaleFactor,
    }));
    res.json({ markers });
  })
);
