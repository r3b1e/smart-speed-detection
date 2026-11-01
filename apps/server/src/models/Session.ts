import { Schema, model, type Document, type Model, type Types } from "mongoose";

export interface ISession extends Document {
  deviceId: Types.ObjectId;
  bootId: string;
  startedAt: Date;
  endedAt: Date | null;
  location: { type: "Point"; coordinates: [number, number] };
  detectionCount: number;
  overspeedCount: number;
  maxSpeed: number;
  avgSpeed: number;
  status: "active" | "completed";
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    deviceId: { type: Schema.Types.ObjectId, ref: "Device", required: true, index: true },
    bootId: { type: String, required: true, maxlength: 64 },
    startedAt: { type: Date, required: true, index: true },
    endedAt: { type: Date, default: null },
    location: {
      type: { type: String, enum: ["Point"], default: "Point", required: true },
      coordinates: { type: [Number], required: true },
    },
    detectionCount: { type: Number, default: 0, min: 0 },
    overspeedCount: { type: Number, default: 0, min: 0 },
    maxSpeed: { type: Number, default: 0, min: 0 },
    avgSpeed: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["active", "completed"], default: "active", required: true },
  },
  { timestamps: true }
);

// Indexes for efficient querying
sessionSchema.index({ deviceId: 1, bootId: 1 }, { unique: true });
sessionSchema.index({ startedAt: -1 });
sessionSchema.index({ status: 1, updatedAt: -1 });
sessionSchema.index({ location: "2dsphere" });

export interface SessionSummary {
  id: string;
  deviceId: string;
  deviceName?: string;
  bootId: string;
  startedAt: string;
  endedAt: string | null;
  location: { type: "Point"; coordinates: [number, number] };
  detectionCount: number;
  overspeedCount: number;
  maxSpeed: number;
  avgSpeed: number;
  status: "active" | "completed";
  duration: number | null; // seconds
}

export function toPublicSession(s: ISession, deviceName?: string): SessionSummary {
  const duration =
    s.endedAt && s.startedAt
      ? Math.floor((s.endedAt.getTime() - s.startedAt.getTime()) / 1000)
      : null;

  return {
    id: s.id,
    deviceId: s.deviceId.toString(),
    ...(deviceName !== undefined ? { deviceName } : {}),
    bootId: s.bootId,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    location: { type: "Point", coordinates: [...s.location.coordinates] },
    detectionCount: s.detectionCount,
    overspeedCount: s.overspeedCount,
    maxSpeed: s.maxSpeed,
    avgSpeed: s.avgSpeed,
    status: s.status,
    duration,
  };
}

export const Session: Model<ISession> = model<ISession>("Session", sessionSchema);
