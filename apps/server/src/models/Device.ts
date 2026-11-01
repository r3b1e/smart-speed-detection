import type { Device as DeviceDto } from "@smart-speed/shared";
import { Schema, model, type Document, type Model } from "mongoose";

export interface IDevice extends Document {
  gateSlot?: "primary";
  name: string;
  apiKeyHash: string;
  apiKeyPrefix: string;
  location: { type: "Point"; coordinates: [number, number] };
  address: string | null;
  scaleFactor: number;
  speedLimitKmh: number;
  status: "active" | "maintenance" | "disabled";
  lastSeenAt: Date | null;
  bridgeOnline: boolean;
  cameraStatus: "ok" | "waiting" | "offline";
  firmwareVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const deviceSchema = new Schema<IDevice>(
  {
    gateSlot: { type: String, enum: ["primary"] },
    name: { type: String, required: true, trim: true, maxlength: 80, unique: true },
    apiKeyHash: { type: String, required: true, unique: true, index: true },
    apiKeyPrefix: { type: String, required: true },
    location: {
      type: { type: String, enum: ["Point"], default: "Point", required: true },
      coordinates: { type: [Number], required: true },
    },
    address: { type: String, default: null, maxlength: 200 },
    scaleFactor: { type: Number, required: true, default: 1, min: 0.01 },
    speedLimitKmh: { type: Number, required: true, default: 40, min: 5, max: 200 },
    status: {
      type: String,
      enum: ["active", "maintenance", "disabled"],
      default: "active",
      required: true,
    },
    lastSeenAt: { type: Date, default: null },
    bridgeOnline: { type: Boolean, default: false },
    cameraStatus: { type: String, enum: ["ok", "waiting", "offline"], default: "waiting" },
    firmwareVersion: { type: String, default: null },
  },
  { timestamps: true }
);

deviceSchema.index({ location: "2dsphere" });
deviceSchema.index({ status: 1 });
deviceSchema.index({ gateSlot: 1 }, { unique: true, sparse: true });

export function toPublicDevice(d: IDevice): DeviceDto {
  return {
    id: d.id,
    name: d.name,
    address: d.address,
    location: { type: "Point", coordinates: [...d.location.coordinates] },
    scaleFactor: d.scaleFactor,
    speedLimitKmh: d.speedLimitKmh,
    status: d.status,
    lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
    bridgeOnline: d.bridgeOnline,
    cameraStatus: d.cameraStatus,
    firmwareVersion: d.firmwareVersion,
    apiKeyPrefix: d.apiKeyPrefix,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export const Device: Model<IDevice> = model<IDevice>("Device", deviceSchema);
