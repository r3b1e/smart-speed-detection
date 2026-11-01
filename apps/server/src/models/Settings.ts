import type { Settings as SettingsDto } from "@smart-speed/shared";
import { Schema, model, type Document, type Model } from "mongoose";

export interface ISettings extends Document {
  key: "singleton";
  defaultLimitKmh: number;
  scaleFactor: number;
  captureOffsetMs: number;
  retentionDays: number;
  alertSound: boolean;
  updatedAt: Date;
}

const settingsSchema = new Schema<ISettings>(
  {
    key: { type: String, enum: ["singleton"], required: true, unique: true },
    defaultLimitKmh: { type: Number, required: true, default: 40, min: 5, max: 200 },
    scaleFactor: { type: Number, required: true, default: 1, min: 0.01 },
    captureOffsetMs: { type: Number, required: true, default: 200 },
    retentionDays: { type: Number, required: true, default: 90, min: 1, max: 3650 },
    alertSound: { type: Boolean, required: true, default: true },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

export const SETTINGS_KEY = "singleton";

export const DEFAULT_SETTINGS = {
  defaultLimitKmh: 40,
  scaleFactor: 1,
  captureOffsetMs: 200,
  retentionDays: 90,
  alertSound: true,
};

/** Get the singleton, creating it with defaults on first use. */
export async function getSettings(): Promise<ISettings> {
  const doc = await Settings.findOne({ key: SETTINGS_KEY });
  if (doc) return doc;
  return Settings.create({ key: SETTINGS_KEY, ...DEFAULT_SETTINGS });
}

export function toPublicSettings(s: ISettings): SettingsDto {
  return {
    defaultLimitKmh: s.defaultLimitKmh,
    scaleFactor: s.scaleFactor,
    captureOffsetMs: s.captureOffsetMs,
    retentionDays: s.retentionDays,
    alertSound: s.alertSound,
    updatedAt: s.updatedAt ? s.updatedAt.toISOString() : null,
  };
}

export const Settings: Model<ISettings> = model<ISettings>("Settings", settingsSchema);
