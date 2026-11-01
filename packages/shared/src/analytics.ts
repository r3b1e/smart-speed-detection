import { z } from "zod";
import { ISO_DATE } from "./common";
import { SummaryPeriodSchema, type TimeseriesBucket } from "./detection";

export const DateRangeQuerySchema = z.object({
  from: ISO_DATE.optional(),
  to: ISO_DATE.optional(),
  period: SummaryPeriodSchema.optional(),
  deviceId: z.string().optional(),
});
export type DateRangeQuery = z.infer<typeof DateRangeQuerySchema>;

export const TimeseriesQuerySchema = DateRangeQuerySchema.extend({
  bucket: z.enum(["minute", "hour", "day"]).default("hour"),
});
export type TimeseriesQuery = z.infer<typeof TimeseriesQuerySchema>;

export const CompareQuerySchema = z.object({
  from: ISO_DATE,
  to: ISO_DATE,
  deviceId: z.string().optional(),
});
export type CompareQuery = z.infer<typeof CompareQuerySchema>;

export type { TimeseriesBucket };
