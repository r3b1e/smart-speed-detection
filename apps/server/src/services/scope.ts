import type { Request } from "express";
import type { FilterQuery } from "mongoose";
import type { IDetection } from "../models";
import { Vehicle } from "../models";

/**
 * Role scoping for detection reads: users only ever see rows whose plate they
 * own (authority/admin see everything).
 */
export async function plateScope(req: Request): Promise<FilterQuery<IDetection> | null> {
  if (!req.user || req.user.role === "admin" || req.user.role === "authority") return null;
  const vehicles = await Vehicle.find({ ownerUserId: req.user._id }).select("plate");
  return { plate: { $in: vehicles.map((v) => v.plate) } };
}

/** Returns true when the requesting user may see a detection with this plate. */
export async function canSeePlate(req: Request, plate: string | null): Promise<boolean> {
  if (!req.user || req.user.role === "admin" || req.user.role === "authority") return true;
  if (plate === null) return false;
  const owned = await Vehicle.exists({ ownerUserId: req.user._id, plate });
  return owned !== null;
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ISO_DATE allows a bare `YYYY-MM-DD`; `from` starts it, `to` ends it. */
export function rangeStart(value?: string): Date | undefined {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
}

export function rangeEnd(value?: string): Date | undefined {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59.999Z`) : new Date(value);
}
