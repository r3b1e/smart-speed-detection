import type { Detection as DetectionDto } from "@smart-speed/shared";
import { Schema, model, type Types, type Document, type Model } from "mongoose";

export interface IFrameSub {
  fileId: Types.ObjectId | null;
  thumbFileId: Types.ObjectId | null;
  capturedAt: Date | null;
  status: "pending" | "ready" | "failed" | "skipped";
}

export interface IReviewSub {
  status: "pending" | "confirmed" | "dismissed";
  by: Types.ObjectId | null;
  at: Date | null;
  note: string | null;
}

export interface IFineSub {
  amount: number;
  status: "unpaid" | "paid" | "waived";
}

export interface IDetection extends Document {
  deviceId: Types.ObjectId;
  bootId: string;
  seq: number;
  source: "arduino";
  vehicleUid: string;
  measuredSpeedKmh: number;
  scaledSpeedKmh: number;
  limitKmh: number;
  overspeed: boolean;
  deviceOver: boolean;
  severity: "low" | "medium" | "high";
  direction: "fwd" | "rev";
  dtMicros: number;
  detectedAt: Date;
  receivedAt: Date;
  location: { type: "Point"; coordinates: [number, number] };
  frame: IFrameSub;
  plate: string | null;
  review: IReviewSub;
  fine: IFineSub | null;
  createdAt: Date;
  updatedAt: Date;
}

const detectionSchema = new Schema<IDetection>(
  {
    deviceId: { type: Schema.Types.ObjectId, ref: "Device", required: true },
    bootId: { type: String, required: true, maxlength: 64 },
    seq: { type: Number, required: true, min: 0 },
    source: { type: String, enum: ["arduino"], required: true },
    vehicleUid: { type: String, required: true },
    measuredSpeedKmh: { type: Number, required: true, min: 0 },
    scaledSpeedKmh: { type: Number, required: true, min: 0 },
    limitKmh: { type: Number, required: true, min: 0 },
    overspeed: { type: Boolean, required: true, default: false },
    deviceOver: { type: Boolean, required: true },
    severity: { type: String, enum: ["low", "medium", "high"], required: true },
    direction: { type: String, enum: ["fwd", "rev"], required: true },
    dtMicros: { type: Number, required: true, min: 0 },
    detectedAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true },
    location: {
      type: { type: String, enum: ["Point"], default: "Point", required: true },
      coordinates: { type: [Number], required: true },
    },
    frame: {
      fileId: { type: Schema.Types.ObjectId, default: null },
      thumbFileId: { type: Schema.Types.ObjectId, default: null },
      capturedAt: { type: Date, default: null },
      status: {
        type: String,
        enum: ["pending", "ready", "failed", "skipped"],
        default: "pending",
        required: true,
      },
    },
    plate: { type: String, default: null, uppercase: true, trim: true },
    review: {
      status: { type: String, enum: ["pending", "confirmed", "dismissed"], default: "pending" },
      by: { type: Schema.Types.ObjectId, ref: "User", default: null },
      at: { type: Date, default: null },
      note: { type: String, default: null, maxlength: 500 },
    },
    fine: {
      _id: false,
      amount: { type: Number, min: 0 },
      status: { type: String, enum: ["unpaid", "paid", "waived"] },
    },
  },
  { timestamps: true }
);

detectionSchema.index({ detectedAt: -1 });
detectionSchema.index({ deviceId: 1, detectedAt: -1 });
detectionSchema.index({ overspeed: 1, detectedAt: -1 });
detectionSchema.index({ location: "2dsphere" });
detectionSchema.index({ deviceId: 1, bootId: 1, seq: 1 }, { unique: true });
detectionSchema.index({ plate: 1, detectedAt: -1 });
detectionSchema.index({ severity: 1, detectedAt: -1 });
detectionSchema.index({ "review.status": 1, detectedAt: -1 });

export function toPublicDetection(d: IDetection, deviceName?: string): DetectionDto {
  const f = d.frame;
  return {
    id: d.id,
    deviceId: d.deviceId.toString(),
    ...(deviceName !== undefined ? { deviceName } : {}),
    seq: d.seq,
    bootId: d.bootId,
    vehicleUid: d.vehicleUid,
    measuredSpeedKmh: d.measuredSpeedKmh,
    scaledSpeedKmh: d.scaledSpeedKmh,
    limitKmh: d.limitKmh,
    overspeed: d.overspeed,
    deviceOver: d.deviceOver,
    severity: d.severity,
    direction: d.direction,
    dtMicros: d.dtMicros,
    detectedAt: d.detectedAt.toISOString(),
    receivedAt: d.receivedAt.toISOString(),
    location: { type: "Point", coordinates: [...d.location.coordinates] },
    source: d.source,
    frame: {
      fileId: f.fileId ? f.fileId.toString() : null,
      thumbFileId: f.thumbFileId ? f.thumbFileId.toString() : null,
      capturedAt: f.capturedAt ? f.capturedAt.toISOString() : null,
      status: f.status,
    },
    plate: d.plate,
    review: {
      status: d.review.status,
      by: d.review.by ? d.review.by.toString() : null,
      at: d.review.at ? d.review.at.toISOString() : null,
      note: d.review.note,
    },
    fine: d.fine ? { amount: d.fine.amount, status: d.fine.status } : null,
  };
}

export const Detection: Model<IDetection> = model<IDetection>("Detection", detectionSchema);
