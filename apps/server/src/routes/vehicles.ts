import { VehicleCreateSchema, VehicleUpdateSchema } from "@smart-speed/shared";
import { Router } from "express";
import { AppError, ah } from "../errors";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Detection, Vehicle, toPublicVehicle } from "../models";
import { audit } from "../services/audit";

export const vehiclesRouter = Router();

vehiclesRouter.use(requireAuth);

/** Owners see only their own vehicles; admins can inspect any. */
vehiclesRouter.get(
  "/",
  ah(async (req, res) => {
    const filter = req.user!.role === "admin" ? {} : { ownerUserId: req.user!._id };
    const vehicles = await Vehicle.find(filter).sort({ createdAt: -1 });
    const counts = await Detection.aggregate<{ _id: string; n: number }>([
      { $match: { source: "arduino", plate: { $in: vehicles.map((v) => v.plate) } } },
      { $group: { _id: "$plate", n: { $sum: 1 } } },
    ]);
    const countByPlate = new Map(counts.map((c) => [c._id, c.n]));
    res.json({ items: vehicles.map((v) => toPublicVehicle(v, countByPlate.get(v.plate) ?? 0)) });
  })
);

vehiclesRouter.post(
  "/",
  validate({ body: VehicleCreateSchema }),
  ah(async (req, res) => {
    const { plate, nickname } = req.body as { plate: string; nickname?: string };
    const existing = await Vehicle.findOne({ plate });
    if (existing) {
      if (existing.ownerUserId.toString() === req.user!.id) {
        throw new AppError("CONFLICT", "you already registered this plate");
      }
      throw new AppError("CONFLICT", "this plate is registered to another owner");
    }
    const vehicle = await Vehicle.create({
      ownerUserId: req.user!._id,
      plate,
      nickname: nickname ?? null,
    });
    await audit({
      actor: req.user!,
      action: "vehicle.create",
      entity: "vehicle",
      entityId: vehicle.id,
      meta: { plate },
    });
    res.status(201).json({ vehicle: toPublicVehicle(vehicle, 0) });
  })
);

vehiclesRouter.patch(
  "/:id",
  validate({ body: VehicleUpdateSchema }),
  ah(async (req, res) => {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) throw new AppError("NOT_FOUND", "vehicle not found");
    const isOwner = vehicle.ownerUserId.toString() === req.user!.id;
    if (!isOwner && req.user!.role !== "admin") {
      throw new AppError("FORBIDDEN", "not your vehicle");
    }
    const { nickname } = req.body as { nickname?: string };
    if (nickname !== undefined) vehicle.nickname = nickname;
    await vehicle.save();
    res.json({ vehicle: toPublicVehicle(vehicle) });
  })
);

vehiclesRouter.delete(
  "/:id",
  ah(async (req, res) => {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) throw new AppError("NOT_FOUND", "vehicle not found");
    const isOwner = vehicle.ownerUserId.toString() === req.user!.id;
    if (!isOwner && req.user!.role !== "admin") {
      throw new AppError("FORBIDDEN", "not your vehicle");
    }
    await vehicle.deleteOne();
    await audit({
      actor: req.user!,
      action: "vehicle.delete",
      entity: "vehicle",
      entityId: req.params.id,
      meta: { plate: vehicle.plate },
    });
    res.status(204).end();
  })
);
