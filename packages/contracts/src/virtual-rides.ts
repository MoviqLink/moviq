import { z } from 'zod';
import { merchantSummarySchema, needViewSchema, orderViewSchema, tasteSchema } from './commerce.js';
import { journeySchema, planResponseSchema } from './journeys.js';
import { placeSchema } from './legs.js';
import { liveSourceSchema, liveVehicleSchema } from './live.js';
import { moneySchema } from './money.js';
import { instantSchema } from './time.js';

const suggestionSchema = z.object({
  invitationId: z.string(),
  expiresAt: instantSchema,
  status: z.enum(['offered', 'expired']),
  merchant: merchantSummarySchema,
  itemId: z.string(),
  name: z.string(),
  listPrice: moneySchema,
});
const stopSchema = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  arrival: instantSchema.nullable(),
  departure: instantSchema.nullable(),
  suggestions: z.array(suggestionSchema),
});
export const virtualRideSchema = z.object({
  id: z.string(),
  status: z.enum(['following', 'lost', 'ended']),
  vehicle: liveVehicleSchema,
  sources: z.array(liveSourceSchema),
  stops: z.array(stopSchema).max(8),
  updatedAt: instantSchema,
  journeyId: z.string().nullable(),
  needs: z.array(needViewSchema),
  orders: z.array(z.object({ offerId: z.string(), order: orderViewSchema })),
});
export type VirtualRide = z.infer<typeof virtualRideSchema>;
export const virtualCurrentSchema = z.object({ ride: virtualRideSchema.nullable() });
export const virtualCreateSchema = z.strictObject({ vehicleId: z.string().min(1).max(200) });
export const virtualNeedSchema = z.strictObject({
  invitationId: z.string().min(1).max(100),
  alias: z.string().regex(/^[\p{L}][\p{L} .'-]{0,23}$/u),
  taste: tasteSchema,
  language: z.enum(['en', 'es']),
});
export const virtualEstimateRequestSchema = z.strictObject({
  offerId: z.string().min(1).max(100),
  origin: placeSchema,
});
export const virtualEstimateResponseSchema = z.object({ plan: planResponseSchema });
export const virtualJourneyRequestSchema = z.strictObject({ offerId: z.string().min(1).max(100) });
export const virtualJourneyResponseSchema = z.object({ journey: journeySchema });
export const virtualPlacesSchema = z.object({ places: z.array(placeSchema) });
export const virtualMetricsSchema = z.object({
  visits: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  visitedReal: z.number().int().nonnegative(),
});
