import {
  DateRangeQuerySchema,
  TimeseriesQuerySchema,
  type AnalyticsSummary,
  type ByDeviceResponse,
  type HeatmapResponse,
  type SpeedDistributionResponse,
  type TimeseriesResponse,
  type TopViolationsResponse,
  type TrendPoint,
} from "@smart-speed/shared";
import { Router } from "express";
import { ah } from "../errors";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Device, Detection } from "../models";
import { plateScope, rangeEnd, rangeStart } from "../services/scope";
import type { FilterQuery, PipelineStage } from "mongoose";
import type { IDetection } from "../models";

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

type RangeQuery = {
  from?: string;
  to?: string;
  period?: "today" | "7d" | "30d";
  deviceId?: string;
};

interface Window {
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
}

function resolveWindow(q: RangeQuery): Window {
  const now = new Date();
  if (q.from || q.to) {
    const to = q.to ? rangeEnd(q.to)! : now;
    const from = q.from ? rangeStart(q.from)! : new Date(to.getTime() - 7 * 86400_000);
    const span = to.getTime() - from.getTime();
    return { from, to, prevFrom: new Date(from.getTime() - span), prevTo: from };
  }
  const period = q.period ?? "7d";
  if (period === "today") {
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const span = now.getTime() - startOfDay.getTime();
    return {
      from: startOfDay,
      to: now,
      prevFrom: new Date(startOfDay.getTime() - span),
      prevTo: startOfDay,
    };
  }
  const days = period === "7d" ? 7 : 30;
  const from = new Date(now.getTime() - days * 86400_000);
  return { from, to: now, prevFrom: new Date(from.getTime() - days * 86400_000), prevTo: from };
}

async function baseFilter(
  req: Parameters<typeof plateScope>[0],
  q: RangeQuery
): Promise<FilterQuery<IDetection>> {
  const filter: FilterQuery<IDetection> = { source: "arduino" };
  if (q.deviceId) filter.deviceId = q.deviceId;
  const scope = await plateScope(req);
  if (scope) filter.$and = [scope];
  return filter;
}

function windowMatch(from: Date, to: Date): PipelineStage.Match["$match"] {
  return { detectedAt: { $gte: from, $lt: to } };
}

interface Totals {
  total: number;
  overspeed: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
}

async function totals(filter: FilterQuery<IDetection>, from: Date, to: Date): Promise<Totals> {
  const [row] = await Detection.aggregate<{
    _id: null;
    total: number;
    overspeed: number;
    avg: number;
    max: number;
  }>([
    { $match: { ...filter, ...windowMatch(from, to) } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        overspeed: { $sum: { $cond: ["$overspeed", 1, 0] } },
        avg: { $avg: "$scaledSpeedKmh" },
        max: { $max: "$scaledSpeedKmh" },
      },
    },
  ]);
  return {
    total: row?.total ?? 0,
    overspeed: row?.overspeed ?? 0,
    avgSpeedKmh: row ? Math.round(row.avg * 10) / 10 : 0,
    maxSpeedKmh: row?.max ?? 0,
  };
}

function trend(cur: number, prev: number): TrendPoint {
  const rounded = Math.round(cur * 10) / 10;
  if (prev === 0) return { value: rounded, deltaPct: null };
  return { value: rounded, deltaPct: Math.round(((cur - prev) / prev) * 1000) / 10 };
}

analyticsRouter.get(
  "/summary",
  validate({ query: DateRangeQuerySchema }),
  ah(async (req, res) => {
    const q = req.query as unknown as RangeQuery;
    const win = resolveWindow(q);
    const filter = await baseFilter(req, q);
    const [current, previous] = await Promise.all([
      totals(filter, win.from, win.to),
      totals(filter, win.prevFrom, win.prevTo),
    ]);
    const summary: AnalyticsSummary = {
      period: q.period ?? (q.from || q.to ? "7d" : "7d"),
      total: trend(current.total, previous.total),
      overspeed: trend(current.overspeed, previous.overspeed),
      avgSpeedKmh: trend(current.avgSpeedKmh, previous.avgSpeedKmh),
      maxSpeedKmh: current.maxSpeedKmh,
      violationRate:
        current.total === 0 ? 0 : Math.round((current.overspeed / current.total) * 1000) / 1000,
      generatedAt: new Date().toISOString(),
    };
    res.json(summary);
  })
);

analyticsRouter.get(
  "/timeseries",
  validate({ query: TimeseriesQuerySchema }),
  ah(async (req, res) => {
    const q = req.query as unknown as RangeQuery & { bucket: "minute" | "hour" | "day" };
    const win = resolveWindow(q);
    const filter = await baseFilter(req, q);
    const rows = await Detection.aggregate<{
      _id: string;
      total: number;
      overspeed: number;
      avg: number;
      max: number;
    }>([
      { $match: { ...filter, ...windowMatch(win.from, win.to) } },
      {
        $group: {
          _id: { $dateTrunc: { date: "$detectedAt", unit: q.bucket, timezone: "UTC" } },
          total: { $sum: 1 },
          overspeed: { $sum: { $cond: ["$overspeed", 1, 0] } },
          avg: { $avg: "$scaledSpeedKmh" },
          max: { $max: "$scaledSpeedKmh" },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const response: TimeseriesResponse = {
      bucket: q.bucket,
      points: rows.map((r) => ({
        t: new Date(r._id).toISOString(),
        total: r.total,
        overspeed: r.overspeed,
        avgSpeedKmh: Math.round(r.avg * 10) / 10,
        maxSpeedKmh: r.max,
      })),
    };
    res.json(response);
  })
);

analyticsRouter.get(
  "/hourly-heatmap",
  validate({ query: DateRangeQuerySchema }),
  ah(async (req, res) => {
    const q = req.query as unknown as RangeQuery;
    const win = resolveWindow(q);
    const filter = await baseFilter(req, q);
    const rows = await Detection.aggregate<{
      _id: { dow: number; hour: number };
      count: number;
      over: number;
    }>([
      { $match: { ...filter, ...windowMatch(win.from, win.to) } },
      {
        $group: {
          _id: {
            dow: { $subtract: [{ $isoDayOfWeek: "$detectedAt" }, 1] },
            hour: { $hour: "$detectedAt" },
          },
          count: { $sum: 1 },
          over: { $sum: { $cond: ["$overspeed", 1, 0] } },
        },
      },
    ]);
    const matrix = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    const overspeedMatrix = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    let maxCount = 0;
    for (const row of rows) {
      matrix[row._id.dow]![row._id.hour] = row.count;
      overspeedMatrix[row._id.dow]![row._id.hour] = row.over;
      maxCount = Math.max(maxCount, row.count);
    }
    const response: HeatmapResponse = { matrix, overspeedMatrix, maxCount };
    res.json(response);
  })
);

analyticsRouter.get(
  "/speed-distribution",
  validate({ query: DateRangeQuerySchema }),
  ah(async (req, res) => {
    const q = req.query as unknown as RangeQuery;
    const win = resolveWindow(q);
    const filter = await baseFilter(req, q);
    const rows = await Detection.aggregate<{ _id: number; count: number; over: number }>([
      { $match: { ...filter, ...windowMatch(win.from, win.to) } },
      {
        $group: {
          _id: { $multiply: [{ $floor: { $divide: ["$scaledSpeedKmh", 10] } }, 10] },
          count: { $sum: 1 },
          over: { $sum: { $cond: ["$overspeed", 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const maxBin = rows.length > 0 ? Math.max(...rows.map((r) => r._id)) : 90;
    const byBin = new Map(rows.map((r) => [r._id, r]));
    const buckets: SpeedDistributionResponse["buckets"] = [];
    for (let from = 0; from <= maxBin; from += 10) {
      const row = byBin.get(from);
      buckets.push({ from, to: from + 10, count: row?.count ?? 0, overspeed: row?.over ?? 0 });
    }
    const response: SpeedDistributionResponse = { buckets, unit: "km/h" };
    res.json(response);
  })
);

analyticsRouter.get(
  "/by-device",
  validate({ query: DateRangeQuerySchema }),
  ah(async (req, res) => {
    const q = req.query as unknown as RangeQuery;
    const win = resolveWindow(q);
    const filter = await baseFilter(req, q);
    const rows = await Detection.aggregate<{
      _id: string;
      total: number;
      overspeed: number;
      avg: number;
      max: number;
    }>([
      { $match: { ...filter, ...windowMatch(win.from, win.to) } },
      {
        $group: {
          _id: "$deviceId",
          total: { $sum: 1 },
          overspeed: { $sum: { $cond: ["$overspeed", 1, 0] } },
          avg: { $avg: "$scaledSpeedKmh" },
          max: { $max: "$scaledSpeedKmh" },
        },
      },
      { $sort: { total: -1 } },
    ]);
    const devices = await Device.find({}).select("name");
    const names = new Map(devices.map((d) => [String(d._id), d.name]));
    const response: ByDeviceResponse = {
      rows: rows.map((r) => ({
        deviceId: String(r._id),
        name: names.get(String(r._id)) ?? "unknown station",
        total: r.total,
        overspeed: r.overspeed,
        avgSpeedKmh: Math.round(r.avg * 10) / 10,
        maxSpeedKmh: r.max,
        violationRate: r.total === 0 ? 0 : Math.round((r.overspeed / r.total) * 1000) / 1000,
      })),
    };
    res.json(response);
  })
);

analyticsRouter.get(
  "/top-violations",
  requireRole("admin", "authority"),
  validate({ query: DateRangeQuerySchema }),
  ah(async (req, res) => {
    const q = req.query as unknown as RangeQuery;
    const win = resolveWindow(q);
    const filter = await baseFilter(req, q);
    const rows = await Detection.aggregate<{
      _id: string;
      deviceId: string;
      plate: string | null;
      scaledSpeedKmh: number;
      limitKmh: number;
      overspeedByPct: number;
      severity: string;
      detectedAt: Date;
    }>([
      { $match: { ...filter, overspeed: true, ...windowMatch(win.from, win.to) } },
      {
        $addFields: {
          overspeedByPct: {
            $multiply: [
              { $divide: [{ $subtract: ["$scaledSpeedKmh", "$limitKmh"] }, "$limitKmh"] },
              100,
            ],
          },
        },
      },
      { $sort: { overspeedByPct: -1 } },
      { $limit: 50 },
    ]);
    const devices = await Device.find({ _id: { $in: rows.map((r) => r.deviceId) } }).select("name");
    const names = new Map(devices.map((d) => [String(d._id), d.name]));
    const response: TopViolationsResponse = {
      rows: rows.map((r) => ({
        detectionId: r._id,
        deviceId: String(r.deviceId),
        deviceName: names.get(String(r.deviceId)) ?? "unknown station",
        plate: r.plate,
        scaledSpeedKmh: r.scaledSpeedKmh,
        limitKmh: r.limitKmh,
        overspeedByPct: Math.round(r.overspeedByPct * 10) / 10,
        severity: r.severity as "low" | "medium" | "high",
        detectedAt: r.detectedAt.toISOString(),
      })),
    };
    res.json(response);
  })
);
