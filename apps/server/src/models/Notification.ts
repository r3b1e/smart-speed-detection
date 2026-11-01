/**
 * Persistent notification record.
 * Created for every overspeed detection — one per authority user + admin.
 * Allows authorities to see missed alerts after reconnecting.
 */
import { Schema, model, type Document, type Model, type Types } from "mongoose";

export interface INotification extends Document {
  recipientId: Types.ObjectId;
  detectionId: Types.ObjectId;
  deviceName: string;
  scaledSpeedKmh: number;
  limitKmh: number;
  severity: "low" | "medium" | "high";
  plate: string | null;
  detectedAt: Date;
  frameUrl: string | null;
  read: boolean;
  emailSent: boolean;
  emailError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    recipientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    detectionId: { type: Schema.Types.ObjectId, ref: "Detection", required: true },
    deviceName: { type: String, required: true },
    scaledSpeedKmh: { type: Number, required: true },
    limitKmh: { type: Number, required: true },
    severity: { type: String, enum: ["low", "medium", "high"], required: true },
    plate: { type: String, default: null },
    detectedAt: { type: Date, required: true },
    frameUrl: { type: String, default: null },
    read: { type: Boolean, default: false },
    emailSent: { type: Boolean, default: false },
    emailError: { type: String, default: null },
  },
  { timestamps: true }
);

notificationSchema.index({ recipientId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ detectionId: 1, recipientId: 1 }, { unique: true });
// TTL: auto-delete notifications older than 30 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const Notification: Model<INotification> = model<INotification>(
  "Notification",
  notificationSchema
);
