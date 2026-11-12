import { z } from 'zod';
import { instantSchema } from './time.js';
import { liveModeSchema, modeSummarySchema, liveSourceSchema } from './live.js';

/** A line's operator source is part of its identity: route IDs can repeat across networks. */
export const liveLineKeySchema = z.strictObject({
  mode: liveModeSchema,
  sourceId: z.string().min(1).max(200),
  lineId: z.string().min(1).max(200),
});
export const liveLineSchema = liveLineKeySchema.extend({
  name: z.string().min(1),
  longName: z.string().nullable(),
  vehicleCount: z.number().int().nonnegative(),
});
export const liveLinesResponseSchema = z.object({
  generatedAt: instantSchema,
  modes: z.array(modeSummarySchema),
  sources: z.array(liveSourceSchema),
  lines: z.array(liveLineSchema),
});
export type LiveLineKey = z.infer<typeof liveLineKeySchema>;
export type LiveLine = z.infer<typeof liveLineSchema>;
export type LiveLinesResponse = z.infer<typeof liveLinesResponseSchema>;
