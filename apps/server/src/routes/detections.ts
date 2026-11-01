import {
  DetectionQuerySchema,
  FineActionSchema,
  ReviewActionSchema,
  TagPlateSchema,
  type Paged,
  type Detection as DetectionDto,
} from "@smart-speed/shared";
import { Router } from "express";
import { type Types } from "mongoose";
import { z } from "zod";
import { AppError, ah } from "../errors";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  Device,
  Detection,
  getSettings,
  toPublicDetection,
  type IDetection,
} from "../models";
import { audit } from "../services/audit";
import { sockets } from "../services/sockets";
import { canSeePlate, escapeRegex, plateScope, rangeEnd, rangeStart } from "../services/scope";
import { triggerCapture } from "../services/vision";

const idParams = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) });

export const detectionsRouter = Router();
detectionsRouter.use(requireAuth);

async function deviceNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const devices = await Device.find({ _id: { $in: ids } }).select("name");
  return new Map(devices.map((d) => [d.id, d.name]));
}

async function publish(doc: IDetection): Promise<void> {
  const names = await deviceNames([doc.deviceId.toString()]);
  sockets.detectionUpdated(toPublicDetection(doc, names.get(doc.deviceId.toString())));
}

detectionsRouter.get(
  "/",
  validate({ query: DetectionQuerySchema }),
  ah(async (req, res) => {
    const q = req.query as unknown as ReturnType<typeof DetectionQuerySchema.parse>;
    const filter: Record<string, unknown> = { source: "arduino" };
    const from = rangeStart(q.from);
    const to = rangeEnd(q.to);
    if (from || to) {
      filter.detectedAt = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }
    if (q.deviceId) filter.deviceId = q.deviceId;
    if (q.overspeed !== undefined) filter.overspeed = q.overspeed;
    if (q.severity) filter.severity = q.severity;
    if (q.review) filter["review.status"] = q.review;
    if (q.direction) filter.direction = q.direction;
    if (q.minSpeed !== undefined || q.maxSpeed !== undefined) {
      filter.scaledSpeedKmh = {
        ...(q.minSpeed !== undefined ? { $gte: q.minSpeed } : {}),
        ...(q.maxSpeed !== undefined ? { $lte: q.maxSpeed } : {}),
      };
    }
    if (q.plate) filter.plate = q.plate.trim().toUpperCase();
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), "i");
      filter.$or = [{ plate: rx }, { vehicleUid: rx }];
    }

    const scope = await plateScope(req);
    if (scope) filter.$and = [scope];

    const [sortKey, direction] = q.sort.startsWith("-")
      ? [q.sort.slice(1), "desc" as const]
      : [q.sort, "asc" as const];
    const [total, rows] = await Promise.all([
      Detection.countDocuments(filter),
      Detection.find(filter)
        .sort({ [sortKey]: direction })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
    ]);
    const names = await deviceNames([...new Set(rows.map((r) => r.deviceId.toString()))]);
    const items: DetectionDto[] = rows.map((r) =>
      toPublicDetection(r, names.get(r.deviceId.toString()))
    );
    const body: Paged<DetectionDto> = {
      items,
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
    };
    res.json(body);
  })
);

async function loadArduinoDetection(id: string): Promise<IDetection> {
  const doc = await Detection.findOne({ _id: id, source: "arduino" });
  if (!doc) throw new AppError("NOT_FOUND", "detection not found");
  return doc;
}

async function loadScoped(id: string, req: Parameters<typeof canSeePlate>[0]): Promise<IDetection> {
  const doc = await loadArduinoDetection(id);
  if (!(await canSeePlate(req, doc.plate))) {
    throw new AppError("NOT_FOUND", "detection not found");
  }
  return doc;
}

detectionsRouter.get(
  "/:id",
  validate({ params: idParams }),
  ah(async (req, res) => {
    const doc = await loadScoped(req.params.id!, req);
    const names = await deviceNames([doc.deviceId.toString()]);
    res.json({ detection: toPublicDetection(doc, names.get(doc.deviceId.toString())) });
  })
);

detectionsRouter.post(
  "/:id/review",
  requireRole("admin", "authority"),
  validate({ params: idParams, body: ReviewActionSchema }),
  ah(async (req, res) => {
    const doc = await loadArduinoDetection(req.params.id!);
    doc.review = {
      status: req.body.status,
      by: req.user!._id as Types.ObjectId,
      at: new Date(),
      note: req.body.note ?? null,
    };
    await doc.save();
    await audit({
      actor: req.user!,
      action: "detection.review",
      entity: "detection",
      entityId: doc.id,
      meta: { status: req.body.status },
    });
    await publish(doc);
    const names = await deviceNames([doc.deviceId.toString()]);
    res.json({ detection: toPublicDetection(doc, names.get(doc.deviceId.toString())) });
  })
);

detectionsRouter.post(
  "/:id/tag",
  requireRole("admin", "authority"),
  validate({ params: idParams, body: TagPlateSchema }),
  ah(async (req, res) => {
    const doc = await loadArduinoDetection(req.params.id!);
    doc.plate = req.body.plate;
    await doc.save();
    await audit({
      actor: req.user!,
      action: "detection.tag",
      entity: "detection",
      entityId: doc.id,
      meta: { plate: doc.plate },
    });
    await publish(doc);
    const names = await deviceNames([doc.deviceId.toString()]);
    res.json({ detection: toPublicDetection(doc, names.get(doc.deviceId.toString())) });
  })
);

detectionsRouter.post(
  "/:id/fine",
  requireRole("admin", "authority"),
  validate({ params: idParams, body: FineActionSchema }),
  ah(async (req, res) => {
    const doc = await loadArduinoDetection(req.params.id!);
    doc.fine = { amount: req.body.amount, status: req.body.status };
    await doc.save();
    await audit({
      actor: req.user!,
      action: "detection.fine",
      entity: "detection",
      entityId: doc.id,
      meta: { amount: req.body.amount, status: req.body.status },
    });
    await publish(doc);
    const names = await deviceNames([doc.deviceId.toString()]);
    res.json({ detection: toPublicDetection(doc, names.get(doc.deviceId.toString())) });
  })
);

detectionsRouter.post(
  "/:id/frame/retry",
  requireRole("admin", "authority"),
  validate({ params: idParams }),
  ah(async (req, res) => {
    const doc = await loadArduinoDetection(req.params.id!);
    if (!doc.overspeed) {
      throw new AppError("CONFLICT", "frames are only captured for overspeed detections");
    }
    if (doc.frame.status === "ready") throw new AppError("CONFLICT", "frame is already stored");
    if (doc.frame.status === "pending") {
      throw new AppError("CONFLICT", "a capture is already in progress");
    }
    const settings = await getSettings();
    doc.frame.status = "pending";
    await doc.save();
    await audit({
      actor: req.user!,
      action: "detection.frame.retry",
      entity: "detection",
      entityId: doc.id,
      meta: { from: "failed" },
    });
    sockets.detectionFrame({
      detectionId: doc.id,
      status: "pending",
      thumbUrl: null,
      frameUrl: null,
      capturedAt: null,
    });
    await publish(doc);
    triggerCapture(doc.id, doc.detectedAt, settings.captureOffsetMs);
    const names = await deviceNames([doc.deviceId.toString()]);
    res.json({ detection: toPublicDetection(doc, names.get(doc.deviceId.toString())) });
  })
);
