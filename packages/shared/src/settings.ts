import { z } from "zod";

/** Singleton settings document. */
export const SettingsSchema = z.object({
  defaultLimitKmh: z.number().min(5).max(200),
  scaleFactor: z.number().positive().max(1000),
  /** ms before eventTs that vision picks the frame (default 200). */
  captureOffsetMs: z.number().int().min(-5000).max(5000),
  retentionDays: z.number().int().min(1).max(3650),
  alertSound: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsUpdateSchema = SettingsSchema.partial().omit({ updatedAt: true });
export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;
