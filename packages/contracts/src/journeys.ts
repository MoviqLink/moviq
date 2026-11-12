import { z } from 'zod';

import { itineraryAccessibilitySchema } from './accessibility.js';
import { legSchema, placeSchema, travelModeSchema } from './legs.js';
import { moneySchema } from './money.js';
import { provenanceSchema } from './sources.js';
import { instantSchema } from './time.js';

export {
  legSchema,
  placeSchema,
  travelModeSchema,
  type Leg,
  type Place,
  type TravelMode,
} from './legs.js';

export const preferencesSchema = z.object({
  maxWalkMinutes: z.number().int().min(0).max(60),
  stepFree: z.boolean(),
  modes: z.array(travelModeSchema).min(1),
  /** Minutes to spare at the destination, on top of the plan. */
  spareMinutes: z.number().int().min(0).max(120),
});

/**
 * A flight that sets the deadline: arrive at the airport by its departure minus the margin. It
 * comes from AeroDataBox (`provenance.sourceId` `aerodatabox`) or from the time the traveller
 * read on the boarding pass (`boarding-pass`), which gives no gate, status or revised time.
 * Fields added on 11/11/2026 read as null when absent, so journeys and conversations kept
 * before them still load.
 */
export const flightSchema = z.object({
  carrier: z.string().regex(/^[A-Z0-9]{2,3}$/),
  number: z.string().regex(/^\d{1,4}$/),
  /** The timetable departure from the gate. */
  departureAt: instantSchema,
  /**
   * A newer departure from the gate: `revised`, the live estimate of the airline or the airport;
   * `predicted`, AeroDataBox's experimental estimate from history.
   */
  revisedDeparture: z
    .object({ at: instantSchema, kind: z.enum(['revised', 'predicted']) })
    .nullable()
    .default(null),
  /** When it left the runway, once the source knows it; null before. */
  takeOffAt: instantSchema.nullable().default(null),
  airport: z.enum(['JFK', 'LGA', 'EWR']),
  terminal: z.string().nullable(),
  gate: z.string().nullable().default(null),
  status: z.string().nullable(),
  /** The air traffic control call sign (`AAL100`), to find the aircraft in ADS-B. */
  callSign: z
    .string()
    .regex(/^[A-Z0-9]{2,8}$/)
    .nullable()
    .default(null),
  /** The aircraft's 24-bit ICAO address (`a9d286`), to follow it in ADS-B before it departs. */
  aircraftHex: z
    .string()
    .regex(/^[0-9a-f]{6}$/)
    .nullable()
    .default(null),
  provenance: provenanceSchema,
});

export type Flight = z.infer<typeof flightSchema>;

/** What one source said about the flight in the last check, with its provenance. */
const flightReadingSchema = z.object({
  sourceId: z.string().min(1),
  says: z.string().min(1),
  provenance: provenanceSchema,
});

/**
 * The flight as the watch last checked it, from AeroDataBox, the boarding pass, the FAA's airport
 * status and the aircraft in ADS-B. The departure used for the deadline says where it comes from;
 * with no source it is null and the evidence says so.
 */
export const flightCheckSchema = z.object({
  /** AeroDataBox's latest answer, or null when it has none (no key, no units, no such flight). */
  aerodatabox: flightSchema.nullable(),
  departure: z
    .object({
      at: instantSchema,
      basis: z.enum(['take-off', 'revised', 'scheduled', 'boarding-pass']),
      sourceId: z.string().min(1),
    })
    .nullable(),
  /** The aircraft rolling on the ground or in the air, from ADS-B or AeroDataBox; null otherwise. */
  movement: z
    .object({ phase: z.enum(['taxiing', 'airborne']), sourceId: z.string().min(1) })
    .nullable(),
  /** Which departure is used and why, in one sentence. */
  evidence: z.string().min(1),
  /** Sources that disagree, each sentence with what both say. */
  discrepancies: z.array(z.string().min(1)),
  readings: z.array(flightReadingSchema),
});

export type FlightCheck = z.infer<typeof flightCheckSchema>;

/** `POST /api/plan`: be at `destination` no later than `arriveBy`. */
export const planRequestSchema = z.object({
  origin: placeSchema,
  destination: placeSchema,
  arriveBy: instantSchema,
  preferences: preferencesSchema,
  flight: flightSchema.nullable(),
});

export type PlanRequest = z.infer<typeof planRequestSchema>;

export const itinerarySchema = z.object({
  id: z.string().min(1),
  departAt: instantSchema,
  arriveAt: instantSchema,
  spareMinutes: z.number().int(),
  transfers: z.number().int().nonnegative(),
  walkMinutes: z.number().int().nonnegative(),
  legs: z.array(legSchema).min(1),
  /** The public fare, shown and never sold: buses and the subway are paid with OMNY on board. */
  fare: z.object({ amount: moneySchema, note: z.string().min(1) }).nullable(),
  /**
   * The step-free check of a step-free plan; null for the others. Absent on itineraries kept
   * before 11/11/2026, so they still load.
   */
  accessibility: itineraryAccessibilitySchema.nullable().optional(),
  /**
   * `checked`: every walk was walked on the streets or is the time a station rule sets;
   * `provisional`: at least one is estimated, so its changes are not confirmed and its spare
   * time is approximate. Absent on itineraries kept before 11/11/2026: their legs tell.
   */
  walking: z.enum(['checked', 'provisional']).optional(),
});

export type Itinerary = z.infer<typeof itinerarySchema>;

export const planResponseSchema = z.object({
  /** The server keeps the itineraries; a journey is created from this id, never from client data. */
  planId: z.string().min(1),
  generatedAt: instantSchema,
  itineraries: z.array(itinerarySchema),
  recommendedId: z.string().nullable(),
  /** Plain sentences about what could not be checked, such as a source that is down. */
  notices: z.array(z.string().min(1)),
});

export type PlanResponse = z.infer<typeof planResponseSchema>;

/** `POST /api/journeys`: start watching one itinerary of a plan. */
export const createJourneyRequestSchema = z.object({
  planId: z.string().min(1),
  itineraryId: z.string().min(1),
});

export const watchStatusSchema = z.enum(['on-track', 'at-risk', 'late', 'unknown']);

/**
 * Sara's words on the watch's latest change, written once per change from the journey's own facts.
 * `about` names the verdict, incidents and options explained: another change makes it stale.
 * `basic`: no words from the model (no key, no allowance left, no valid answer, or something
 * personal would have left), so the screen shows the watch's own sentence and says why.
 */
const watchExplanationSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('ai'),
    about: z.string().min(1),
    lang: z.enum(['en', 'es']),
    text: z.string().min(1).max(700),
    writtenAt: instantSchema,
    /** The sources of the facts it was given, each with the time of its data. */
    sources: z
      .array(z.object({ sourceId: z.string().min(1), dataTime: instantSchema.nullable() }))
      .max(8),
  }),
  z.object({
    mode: z.literal('basic'),
    about: z.string().min(1),
    lang: z.enum(['en', 'es']),
    reason: z.enum(['no-model', 'budget', 'model-failed', 'privacy']),
  }),
]);

export const incidentSchema = z.object({
  id: z.string().min(1),
  at: instantSchema,
  legIndex: z.number().int().nonnegative(),
  kind: z.enum(['delay', 'alert', 'traffic', 'airport', 'flight', 'elevator', 'source-down']),
  /** What was observed, in one sentence: the proof behind the warning. */
  evidence: z.string().min(1),
  provenance: provenanceSchema,
  impactMinutes: z.number().int().nullable(),
});

export type Incident = z.infer<typeof incidentSchema>;

export const alternativeSchema = z.object({
  id: z.string().min(1),
  itinerary: itinerarySchema,
  recommended: z.boolean(),
  why: z.string().min(1),
  /** Present when taking it costs money (the demo taxi partner): PayPal approval comes first. */
  price: moneySchema.nullable(),
});

export type Alternative = z.infer<typeof alternativeSchema>;

/** `GET /api/journeys/:id` and each event of `GET /api/journeys/:id/events`. */
export const journeySchema = z.object({
  id: z.string().min(1),
  state: z.enum(['watching', 'completed', 'cancelled']),
  request: planRequestSchema,
  itinerary: itinerarySchema,
  createdAt: instantSchema,
  watch: z.object({
    status: watchStatusSchema,
    evaluatedAt: instantSchema.nullable(),
    /** When the traveller should now arrive, from live data; null until it can be worked out. */
    projectedArriveAt: instantSchema.nullable(),
    evidence: z.string().min(1),
    /** The last check of the flight that sets the deadline; null without a flight or before it. */
    flight: flightCheckSchema.nullable().default(null),
    /**
     * Why no step-free alternative could be looked for (`no-step-free-data`): the MTA lists are
     * not usable, an elevator out cannot be placed, or the modes have no step-free data. Null
     * otherwise, and on journeys kept before 11/11/2026.
     */
    stepFreeRefusal: z
      .object({
        reason: z.enum(['lists-unavailable', 'outage-unplaced', 'modes-without-data']),
        detail: z.string().min(1),
      })
      .nullable()
      .default(null),
    /** Sara's explanation of this verdict; absent or null until she writes one. */
    explanation: watchExplanationSchema.nullable().optional(),
  }),
  incidents: z.array(incidentSchema),
  alternatives: z.array(alternativeSchema),
});

export type Journey = z.infer<typeof journeySchema>;
