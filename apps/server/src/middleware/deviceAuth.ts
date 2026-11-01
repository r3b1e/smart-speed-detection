import type { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { AppError } from "../errors";
import { Device, type IDevice } from "../models";
import { hashApiKey } from "../services/crypto";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      device?: IDevice;
      visionAuth?: boolean;
    }
  }
}

/** Resolves the station from the `x-device-key` header (bridge ingest). */
export async function requireDeviceKey(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const raw = req.headers["x-device-key"];
    const key = typeof raw === "string" ? raw : "";
    if (!key) throw new AppError("INVALID_DEVICE_KEY", "missing x-device-key header");
    const device = await Device.findOne({ apiKeyHash: hashApiKey(key) });
    if (!device) throw new AppError("INVALID_DEVICE_KEY", "unknown device key");
    if (device.status === "disabled") throw new AppError("FORBIDDEN", "station is disabled");
    req.device = device;
    next();
  } catch (err) {
    next(err);
  }
}

/** Vision service authenticates with the shared secret instead of a device key. */
export function requireVisionSecret(req: Request, _res: Response, next: NextFunction): void {
  const secret = req.headers["x-vision-secret"];
  if (typeof secret !== "string" || secret !== config.VISION_SHARED_SECRET) {
    next(new AppError("UNAUTHORIZED", "invalid vision secret"));
    return;
  }
  req.visionAuth = true;
  next();
}

/** Heartbeats and frame uploads accept either credential. */
export async function requireDeviceKeyOrVision(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.headers["x-vision-secret"] !== undefined) {
    requireVisionSecret(req, res, next);
    return;
  }
  await requireDeviceKey(req, res, next);
}
