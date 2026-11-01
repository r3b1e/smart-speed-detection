import {
  HeartbeatSchema,
  IngestAckSchema,
  IngestDetectionSchema,
  round1,
  severityFor,
} from "@smart-speed/shared";
import { Router, type Request } from "express";
import multer from "multer";
import { Types } from "mongoose";
import { z } from "zod";
import { config } from "../config";
import { AppError, ah } from "../errors";
import { requireDeviceKey, requireDeviceKeyOrVision } from "../middleware/deviceAuth";
import { ingestLimiter } from "../middleware/rateLimit";
import { validate } from "../middleware/validate";
import {
  Detection,
  getSettings,
  toPublicDetection,
  type IDevice,
  type IDetection,
} from "../models";
import { newVehicleUid } from "../services/crypto";
import { saveFrame } from "../services/frames";
import { recordHeartbeat } from "../services/health";
import { getOrCreateSession, updateSessionStats } from "../services/sessions";
import { sockets } from "../services/sockets";
import { triggerCapture } from "../services/vision";
import { notifyOverspeed } from "../services/whatsapp";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_FRAME_BYTES, files: 2 },
});

const ingestBodySchema = z.union([
  IngestDetectionSchema,
  z.array(IngestDetectionSchema).min(1).max(100),
]);

const idParamsSchema = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) });

type IngestInput = z.infer<typeof IngestDetectionSchema>;

interface IngestOutcome {
  id: string;
  duplicate: boolean;
  detection?: IDetection;
}

async function storeDetection(station: IDevice, input: IngestInput): Promise<IngestOutcome> {
  const limitKmh = station.speedLimitKmh;
  const scaledSpeedKmh = round1(input.measuredSpeedKmh * station.scaleFactor);
  const overspeed = scaledSpeedKmh > limitKmh;
  const captureRequested = overspeed;
  const severity = severityFor(scaledSpeedKmh, limitKmh);
  const receivedAt = new Date(input.receivedAt);

  try {
    const doc = await Detection.create({
      deviceId: station._id,
      bootId: input.bootId,
      seq: input.seq,
      source: input.source,
      vehicleUid: newVehicleUid(),
      measuredSpeedKmh: round1(input.measuredSpeedKmh),
      scaledSpeedKmh,
      limitKmh,
      overspeed,
      deviceOver: input.deviceOver,
      severity,
      direction: input.direction,
      dtMicros: input.dtMicros,
      detectedAt: receivedAt,
      receivedAt,
      location: station.location,
      frame: { status: captureRequested ? "pending" : "skipped" },
      plate: null,
      review: { status: "pending" },
      fine: null,
    });
    return { id: doc.id, duplicate: false, detection: doc };
  } catch (err) {
    const mongoErr = err as { code?: number; name?: string };
    if (mongoErr.name === "MongoServerError" && mongoErr.code === 11000) {
      const existing = await Detection.findOne({
        deviceId: station._id,
        bootId: input.bootId,
        seq: input.seq,
      }).select("id");
      if (existing) return { id: existing.id, duplicate: true };
    }
    throw err;
  }
}

function publishDetection(doc: IDetection, deviceName: string): void {
  const dto = toPublicDetection(doc, deviceName);
  sockets.detectionNew(dto);
  if (doc.overspeed) {
    sockets.overspeedAlert({
      detectionId: dto.id,
      deviceId: dto.deviceId,
      deviceName,
      scaledSpeedKmh: dto.scaledSpeedKmh,
      limitKmh: dto.limitKmh,
      severity: dto.severity,
      plate: dto.plate,
      at: dto.detectedAt,
    });
  }
}

export const ingestRouter = Router();
ingestRouter.use(ingestLimiter);

/** The bridge's own station record (knows the server-authoritative limit to push). */
ingestRouter.get(
  "/device",
  requireDeviceKey,
  ah(async (req, res) => {
    const device = req.device!;
    res.json({
      id: device.id,
      name: device.name,
      speedLimitKmh: device.speedLimitKmh,
      scaleFactor: device.scaleFactor,
      status: device.status,
    });
  })
);

ingestRouter.post(
  "/detections",
  requireDeviceKey,
  validate({ body: ingestBodySchema }),
  ah(async (req, res) => {
    const device = req.device!;
    const batch: IngestInput[] = Array.isArray(req.body) ? req.body : [req.body];
    const outcomes: IngestOutcome[] = [];
    
    // Create/update session for the first detection in batch
    const firstDetection = batch[0];
    if (firstDetection) {
      const firstDetectionTime = new Date(firstDetection.receivedAt);
      await getOrCreateSession(device, firstDetection.bootId, firstDetectionTime);
    }

    for (const input of batch) {
      outcomes.push(await storeDetection(device, input));
    }

    device.lastSeenAt = new Date();
    device.bridgeOnline = true;
    await device.save();

    const settings = await getSettings();
    for (const outcome of outcomes) {
      if (outcome.duplicate || !outcome.detection) continue;
      
      // Update session statistics
      await updateSessionStats(outcome.detection);
      
      publishDetection(outcome.detection, device.name);
      if (outcome.detection.overspeed) {
        triggerCapture(outcome.id, outcome.detection.detectedAt, settings.captureOffsetMs);
      }
    }

    const acks = outcomes.map((o) => ({ id: o.id, duplicate: o.duplicate }));
    if (Array.isArray(req.body)) {
      res.json({ items: acks });
      return;
    }
    res.status(201).json(IngestAckSchema.parse(acks[0]));
  })
);

const frameUpload = upload.fields([
  { name: "frame", maxCount: 1 },
  { name: "thumb", maxCount: 1 },
]);

ingestRouter.post(
  "/detections/:id/frame",
  requireDeviceKeyOrVision,
  frameUpload,
  validate({ params: idParamsSchema }),
  ah(async (req, res) => {
    const detection = await Detection.findById(req.params.id);
    if (!detection) throw new AppError("NOT_FOUND", "detection not found");
    if (detection.source !== "arduino") {
      throw new AppError("NOT_FOUND", "detection not found");
    }
    if (!detection.overspeed) {
      throw new AppError("CONFLICT", "frames are only accepted for overspeed detections");
    }

    const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
    const frameFile = files.frame?.[0];
    if (!frameFile) throw new AppError("VALIDATION_ERROR", "frame file is required");
    if (frameFile.mimetype !== "image/jpeg") {
      throw new AppError("UNSUPPORTED_MEDIA_TYPE", "frame must be a JPEG");
    }
    const thumbFile = files.thumb?.[0]?.mimetype === "image/jpeg" ? files.thumb[0] : undefined;

    const stored = await saveFrame(frameFile.buffer, {
      filename: `${detection.id}.jpg`,
      contentType: "image/jpeg",
      detectionId: detection.id,
      kind: "frame",
    });
    const thumb = thumbFile
      ? await saveFrame(thumbFile.buffer, {
          filename: `${detection.id}.thumb.jpg`,
          contentType: "image/jpeg",
          detectionId: detection.id,
          kind: "thumb",
        })
      : stored;

    detection.frame = {
      fileId: new Types.ObjectId(stored.id),
      thumbFileId: new Types.ObjectId(thumb.id),
      capturedAt: new Date(),
      status: "ready",
    };
    await detection.save();
    notifyOverspeed(detection.id, frameFile.buffer); // WhatsApp photo alert (no-op unless configured)

    const frameUrl = `${config.PUBLIC_SERVER_URL}/api/frames/${stored.id}`;
    const thumbUrl = `${config.PUBLIC_SERVER_URL}/api/frames/${thumb.id}`;
    sockets.detectionFrame({
      detectionId: detection.id,
      status: "ready",
      thumbUrl,
      frameUrl,
      capturedAt: detection.frame.capturedAt!.toISOString(),
    });
    res.status(201).json({
      fileId: stored.id,
      thumbFileId: thumb.id,
      capturedAt: detection.frame.capturedAt!.toISOString(),
    });
  })
);

ingestRouter.post(
  "/heartbeat",
  requireDeviceKeyOrVision,
  validate({ body: HeartbeatSchema }),
  ah(async (req: Request, res) => {
    const body = req.body;
    await recordHeartbeat({
      source: body.source,
      status: body.status,
      meta: body.meta,
      deviceId: req.device?.id,
    });
    res.status(204).end();
  })
);
