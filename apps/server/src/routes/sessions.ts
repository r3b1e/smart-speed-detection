import { SessionQuerySchema } from "@smart-speed/shared";
import { Router } from "express";
import { z } from "zod";
import { AppError, ah } from "../errors";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Session } from "../models";

const idParamsSchema = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) });

type PopulatedDevice = { _id: unknown; name?: string; speedLimitKmh?: number };

function resolveDevice(raw: unknown): { deviceId: string; deviceName?: string } {
  const d = raw as PopulatedDevice | null;
  if (d && typeof d === "object" && "_id" in d) {
    return { deviceId: String(d._id), deviceName: d.name };
  }
  return { deviceId: String(raw) };
}

function sessionDuration(startedAt: Date, endedAt: Date | null): number | null {
  if (!endedAt) return null;
  return Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
}

export const sessionsRouter = Router();
sessionsRouter.use(requireAuth);

/** GET /api/sessions — list sessions, newest first */
sessionsRouter.get(
  "/",
  validate({ query: SessionQuerySchema }),
  ah(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof SessionQuerySchema>;
    const filter: Record<string, unknown> = {};

    if (q.deviceId) filter.deviceId = q.deviceId;
    if (q.status) filter.status = q.status;
    if (q.from || q.to) {
      const range: Record<string, Date> = {};
      if (q.from) range.$gte = new Date(q.from);
      if (q.to) range.$lte = new Date(q.to);
      filter.startedAt = range;
    }

    const total = await Session.countDocuments(filter);
    const page = q.page;
    const limit = q.limit;

    const sessions = await Session.find(filter)
      .sort({ startedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("deviceId", "name")
      .lean();

    const items = sessions.map((s) => {
      const { deviceId, deviceName } = resolveDevice(s.deviceId);
      return {
        id: s._id.toString(),
        deviceId,
        deviceName,
        bootId: s.bootId,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt ? s.endedAt.toISOString() : null,
        location: s.location,
        detectionCount: s.detectionCount,
        overspeedCount: s.overspeedCount,
        maxSpeed: s.maxSpeed,
        avgSpeed: s.avgSpeed,
        status: s.status,
        duration: sessionDuration(s.startedAt, s.endedAt),
      };
    });

    res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
  })
);

/** GET /api/sessions/active — currently active sessions only */
sessionsRouter.get(
  "/active",
  ah(async (_req, res) => {
    const sessions = await Session.find({ status: "active" })
      .sort({ startedAt: -1 })
      .populate("deviceId", "name")
      .lean();

    const items = sessions.map((s) => {
      const { deviceId, deviceName } = resolveDevice(s.deviceId);
      return {
        id: s._id.toString(),
        deviceId,
        deviceName,
        bootId: s.bootId,
        startedAt: s.startedAt.toISOString(),
        endedAt: null,
        location: s.location,
        detectionCount: s.detectionCount,
        overspeedCount: s.overspeedCount,
        maxSpeed: s.maxSpeed,
        avgSpeed: s.avgSpeed,
        status: "active" as const,
        duration: null,
      };
    });

    res.json({ items, total: items.length });
  })
);

/** GET /api/sessions/:id — single session detail */
sessionsRouter.get(
  "/:id",
  validate({ params: idParamsSchema }),
  ah(async (req, res) => {
    const session = await Session.findById(req.params.id)
      .populate("deviceId", "name speedLimitKmh location")
      .lean();

    if (!session) throw new AppError("NOT_FOUND", "session not found");

    const { deviceId, deviceName } = resolveDevice(session.deviceId);

    res.json({
      session: {
        id: session._id.toString(),
        deviceId,
        deviceName,
        bootId: session.bootId,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt ? session.endedAt.toISOString() : null,
        location: session.location,
        detectionCount: session.detectionCount,
        overspeedCount: session.overspeedCount,
        maxSpeed: session.maxSpeed,
        avgSpeed: session.avgSpeed,
        status: session.status,
        duration: sessionDuration(session.startedAt, session.endedAt),
      },
    });
  })
);
