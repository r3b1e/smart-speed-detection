import {
  DeviceCreateSchema,
  DeviceQuerySchema,
  DeviceUpdateSchema,
  gateTripLimitKmh,
} from "@smart-speed/shared";
import { Router } from "express";
import { AppError, ah } from "../errors";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Device, toPublicDevice } from "../models";
import { audit } from "../services/audit";
import { generateApiKey, hashApiKey } from "../services/crypto";
import { sockets } from "../services/sockets";

export const devicesRouter = Router();

devicesRouter.use(requireAuth);

/** Admin and authority both need the station list (filters, analytics, map). */
devicesRouter.get(
  "/",
  requireRole("admin", "authority"),
  validate({ query: DeviceQuerySchema }),
  ah(async (req, res) => {
    const { page, limit, q, status } = req.query as unknown as {
      page: number;
      limit: number;
      q?: string;
      status?: string;
    };
    const filter: Record<string, unknown> = {};
    if (q) filter.name = { $regex: q, $options: "i" };
    if (status) filter.status = status;
    const [items, total] = await Promise.all([
      Device.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Device.countDocuments(filter),
    ]);
    res.json({
      items: items.map(toPublicDevice),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  })
);

devicesRouter.get(
  "/map-markers",
  requireRole("admin", "authority"),
  ah(async (_req, res) => {
    const items = await Device.find({ status: { $ne: "disabled" } });
    res.json({
      markers: items.map((d) => ({
        id: d.id,
        name: d.name,
        lng: d.location.coordinates[0],
        lat: d.location.coordinates[1],
        bridgeOnline: d.bridgeOnline,
        cameraStatus: d.cameraStatus,
        speedLimitKmh: d.speedLimitKmh,
        scaleFactor: d.scaleFactor,
      })),
    });
  })
);

devicesRouter.post(
  "/",
  requireRole("admin"),
  validate({ body: DeviceCreateSchema }),
  ah(async (req, res) => {
    if (await Device.exists({})) {
      throw new AppError("CONFLICT", "only one gate can be registered");
    }
    const input = req.body as {
      name: string;
      address?: string;
      location: { coordinates: [number, number] };
      scaleFactor: number;
      speedLimitKmh: number;
      status: string;
    };
    const existing = await Device.findOne({ name: input.name });
    if (existing) throw new AppError("CONFLICT", "a station with this name already exists");
    const { key, hash, prefix } = generateApiKey();
    let device;
    try {
      device = await Device.create({
        gateSlot: "primary",
        name: input.name,
        address: input.address ?? null,
        location: { type: "Point", coordinates: input.location.coordinates },
        scaleFactor: input.scaleFactor,
        speedLimitKmh: input.speedLimitKmh,
        status: input.status,
        apiKeyHash: hash,
        apiKeyPrefix: prefix,
      });
    } catch (error) {
      const mongoError = error as { code?: number; keyPattern?: Record<string, unknown> };
      if (mongoError.code === 11000 && mongoError.keyPattern?.gateSlot) {
        throw new AppError("CONFLICT", "only one gate can be registered");
      }
      throw error;
    }
    await audit({
      actor: req.user!,
      action: "device.create",
      entity: "device",
      entityId: device.id,
      meta: { name: device.name },
    });
    res.status(201).json({
      device: toPublicDevice(device),
      apiKey: key,
      note: "Store this API key now — it is shown only once.",
    });
  })
);

devicesRouter.get(
  "/:id",
  ah(async (req, res) => {
    const device = await Device.findById(req.params.id);
    if (!device) throw new AppError("NOT_FOUND", "station not found");
    res.json({ device: toPublicDevice(device) });
  })
);

devicesRouter.patch(
  "/:id",
  requireRole("admin"),
  validate({ body: DeviceUpdateSchema }),
  ah(async (req, res) => {
    const patch = req.body as Partial<{
      name: string;
      address: string;
      location: { coordinates: [number, number] };
      scaleFactor: number;
      speedLimitKmh: number;
      status: "active" | "maintenance" | "disabled";
    }>;
    const device = await Device.findById(req.params.id);
    if (!device) throw new AppError("NOT_FOUND", "station not found");
    if (patch.name && patch.name !== device.name) {
      const clash = await Device.findOne({ name: patch.name });
      if (clash) throw new AppError("CONFLICT", "a station with this name already exists");
    }
    if (patch.name) device.name = patch.name;
    if (patch.address !== undefined) device.address = patch.address;
    if (patch.location)
      device.location = { type: "Point", coordinates: patch.location.coordinates };
    const gateTripSettingsChanged =
      patch.speedLimitKmh !== undefined && patch.speedLimitKmh !== device.speedLimitKmh;
    const scaleChanged =
      patch.scaleFactor !== undefined && patch.scaleFactor !== device.scaleFactor;
    if (patch.scaleFactor !== undefined) device.scaleFactor = patch.scaleFactor;
    if (patch.speedLimitKmh !== undefined) device.speedLimitKmh = patch.speedLimitKmh;
    if (patch.status) device.status = patch.status;
    await device.save();
    if (gateTripSettingsChanged || scaleChanged) {
      sockets.deviceCommand(device.id, {
        cmd: "set_limit",
        kmh: gateTripLimitKmh(device.speedLimitKmh, device.scaleFactor),
        scale: device.scaleFactor,
      });
    }
    await audit({
      actor: req.user!,
      action: "device.update",
      entity: "device",
      entityId: device.id,
      meta: { fields: Object.keys(patch) },
    });
    res.json({ device: toPublicDevice(device) });
  })
);

devicesRouter.post(
  "/:id/rotate-key",
  requireRole("admin"),
  ah(async (req, res) => {
    const device = await Device.findById(req.params.id);
    if (!device) throw new AppError("NOT_FOUND", "station not found");
    const { key, hash, prefix } = generateApiKey();
    device.apiKeyHash = hash;
    device.apiKeyPrefix = prefix;
    await device.save();
    await audit({
      actor: req.user!,
      action: "device.rotate-key",
      entity: "device",
      entityId: device.id,
    });
    res.json({
      device: toPublicDevice(device),
      apiKey: key,
      note: "Store this API key now — it is shown only once. The old key no longer works.",
    });
  })
);

/** Sends `buzzer_test` over the socket command channel to the station's bridge. */
devicesRouter.post(
  "/:id/buzzer-test",
  requireRole("admin"),
  ah(async (req, res) => {
    const device = await Device.findById(req.params.id);
    if (!device) throw new AppError("NOT_FOUND", "station not found");
    sockets.deviceCommand(device.id, { cmd: "buzzer_test" });
    await audit({
      actor: req.user!,
      action: "device.buzzer-test",
      entity: "device",
      entityId: device.id,
    });
    res.json({ ok: true, note: "command sent to the station's bridge" });
  })
);

/**
 * PATCH /api/devices/:id/location
 * Lightweight endpoint to update only the gate's GPS coordinates.
 * Used by the frontend when live scanning starts and geolocation is available.
 */
devicesRouter.patch(
  "/:id/location",
  requireRole("admin", "authority"),
  ah(async (req, res) => {
    const body = req.body as { coordinates?: unknown };
    const coords = body.coordinates;
    if (
      !Array.isArray(coords) ||
      coords.length !== 2 ||
      typeof coords[0] !== "number" ||
      typeof coords[1] !== "number"
    ) {
      throw new AppError("VALIDATION_ERROR", "coordinates must be [lng, lat] numbers");
    }
    const [lng, lat] = coords as [number, number];
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      throw new AppError("VALIDATION_ERROR", "coordinates out of range");
    }
    const device = await Device.findById(req.params.id);
    if (!device) throw new AppError("NOT_FOUND", "station not found");
    device.location = { type: "Point", coordinates: [lng, lat] };
    await device.save();
    sockets.deviceUpdated(toPublicDevice(device));
    await audit({
      actor: req.user!,
      action: "device.location-update",
      entity: "device",
      entityId: device.id,
      meta: { lng, lat },
    });
    res.json({ device: toPublicDevice(device) });
  })
);

/** DELETE = soft-disable: detections keep referencing the station. */
devicesRouter.delete(
  "/:id",
  requireRole("admin"),
  ah(async (req, res) => {
    const device = await Device.findById(req.params.id);
    if (!device) throw new AppError("NOT_FOUND", "station not found");
    device.status = "disabled";
    device.bridgeOnline = false;
    await device.save();
    await audit({
      actor: req.user!,
      action: "device.disable",
      entity: "device",
      entityId: device.id,
    });
    res.json({ device: toPublicDevice(device) });
  })
);

export function deviceKeyMatches(deviceKey: string, storedHash: string): boolean {
  return hashApiKey(deviceKey) === storedHash;
}
