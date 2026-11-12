import { z } from 'zod';

import { airportProgramSchema } from './live.js';
import { provenanceSchema } from './sources.js';
import { instantSchema } from './time.js';

/** The three New York airports a board is kept for. */
export const airportCodeSchema = z.enum(['JFK', 'LGA', 'EWR']);

export type AirportCode = z.infer<typeof airportCodeSchema>;

export const boardDirectionSchema = z.enum(['departures', 'arrivals']);

export type BoardDirection = z.infer<typeof boardDirectionSchema>;

/** `GET /api/airports/:code/board?direction=`: departures unless arrivals are asked. */
export const boardQuerySchema = z.object({
  code: z
    .string()
    .transform((code) => code.toUpperCase())
    .pipe(airportCodeSchema),
  direction: boardDirectionSchema.default('departures'),
});

const text = z.string().min(1);
const icao = z.string().regex(/^[A-Z0-9]{4}$/);

/** AeroDataBox's flight statuses; its `Unknown` is served as null. */
export const boardStatusSchema = z.enum([
  'Expected',
  'CheckIn',
  'Boarding',
  'GateClosed',
  'Departed',
  'Delayed',
  'EnRoute',
  'Approaching',
  'Arrived',
  'Canceled',
  'CanceledUncertain',
  'Diverted',
]);

export type BoardStatus = z.infer<typeof boardStatusSchema>;

/**
 * One flight of a board as AeroDataBox listed it in its last answer, every field from that answer
 * (`provenance`). Times are at this airport: the departure of a departure, the arrival of an
 * arrival; `airport` is the other end.
 */
export const scheduledFlightSchema = z.object({
  /** The flight number and its scheduled time here: stable while the board is refreshed. */
  id: text,
  /** As the airline sells it, such as `AA 100`. */
  number: text,
  airline: z
    .object({ name: text, iata: z.string().nullable(), icao: z.string().nullable() })
    .nullable(),
  /** The air traffic control call sign, such as `AAL100`, when AeroDataBox gives one. */
  callSign: z
    .string()
    .regex(/^[A-Z0-9]{2,8}$/)
    .nullable(),
  /** The destination of a departure, the origin of an arrival. */
  airport: z.object({ name: text, iata: z.string().nullable(), icao: z.string().nullable() }),
  scheduledAt: instantSchema,
  /** The airline's or the airport's newer time at the gate, or at the runway when no other. */
  revisedAt: instantSchema.nullable(),
  /**
   * Take-off of a departure, landing of an arrival: `actual` once passed for a flight that has
   * left or arrived, `estimated` otherwise.
   */
  runway: z.object({ at: instantSchema, kind: z.enum(['actual', 'estimated']) }).nullable(),
  terminal: z.string().nullable(),
  gate: z.string().nullable(),
  status: boardStatusSchema.nullable(),
  /** `live` when AeroDataBox follows this movement live; `timetable` when it only has the plan. */
  basis: z.enum(['live', 'timetable']),
  provenance: provenanceSchema,
});

export type ScheduledFlight = z.infer<typeof scheduledFlightSchema>;

/**
 * Where an aircraft is, seen by ADS-B around one airport:
 * - `approaching`: in the air, coming in to land;
 * - `on-runway`: on the ground at take-off or landing speed (40 knots or more);
 * - `taxiing`: on the ground, rolling (5 to 40 knots);
 * - `on-ground`: on the ground, standing or pushed back (under 5 knots);
 * - `departed`: in the air, climbing away from the airport.
 */
export const movementPhaseSchema = z.enum([
  'approaching',
  'on-runway',
  'taxiing',
  'on-ground',
  'departed',
]);

export type MovementPhase = z.infer<typeof movementPhaseSchema>;

/** One aircraft moving at an airport, with what ADS-B saw and what MovIQ worked out from it. */
export const movementSchema = z.object({
  /** The 24-bit ICAO address of the aircraft, in lower case. */
  hex: text,
  callSign: z.string().nullable(),
  /** The flight its call sign stands for (`AAL100` → `AA 100`); null when it is not one. */
  flight: z.string().nullable(),
  phase: movementPhaseSchema,
  distanceNm: z.number().nonnegative(),
  altitudeFeet: z.number().nullable(),
  groundSpeedKnots: z.number().nonnegative().nullable(),
  /**
   * Worked out from the distance and the ground speed, never broadcast: the landing of an
   * aircraft heading for the airport, the take-off of one climbing away within 12 NM of it.
   */
  estimate: z.object({ at: instantSchema, kind: z.enum(['landing', 'take-off']) }).nullable(),
  /**
   * Where the call sign usually flies (ICAO codes), never today's flight plan; `otherEnd` is the
   * airport before or after this one in it, null when the usual route does not pass here.
   */
  usualRoute: z
    .object({ airports: z.array(icao).min(2), otherEnd: icao.nullable(), sourceId: text })
    .nullable(),
  /** The position's source and time. */
  provenance: provenanceSchema,
});

export type Movement = z.infer<typeof movementSchema>;

/** Why an aircraft moving at the airport is not on the board. */
export const unmatchedReasonSchema = z.enum([
  /** It broadcasts no call sign. */
  'no-call-sign',
  /** Its call sign is not an airline's flight: a registration, a private or an ATC-only one. */
  'not-a-flight',
  /** The board has no flight with that call sign. */
  'not-on-board',
  /** The board has a flight with that call sign, but at another time or going the other way. */
  'off-schedule',
  /** There is no board to compare with. */
  'no-board',
]);

export type UnmatchedReason = z.infer<typeof unmatchedReasonSchema>;

export const boardFlightSchema = scheduledFlightSchema.extend({
  /** The aircraft flying it, seen by ADS-B now; null when it is not seen. */
  live: movementSchema.nullable(),
});

export type BoardFlight = z.infer<typeof boardFlightSchema>;

export const airportBoardSchema = z.object({
  airport: z.object({ code: airportCodeSchema, icao, name: text }),
  direction: boardDirectionSchema,
  generatedAt: instantSchema,
  snapshot: z.object({
    /**
     * `current`: taken within its refresh interval; `kept`: the last one, older, because a new one
     * could not be taken (no units left, provider down), shown with its time; `none`: no board.
     */
    state: z.enum(['current', 'kept', 'none']),
    takenAt: instantSchema.nullable(),
    /** The hours AeroDataBox listed. */
    window: z.object({ from: instantSchema, to: instantSchema }).nullable(),
    /** The earliest a new one may be asked; null while none can be (no key). */
    nextRefreshAt: instantSchema.nullable(),
    provenance: provenanceSchema,
  }),
  /** In the order of their scheduled time here. */
  flights: z.array(boardFlightSchema),
  aircraft: z.object({
    /** Moving at the airport by ADS-B and matching no flight of the board, with why. */
    unmatched: z.array(movementSchema.extend({ reason: unmatchedReasonSchema })),
    /** The ADS-B positions, and the usual routes of call signs. */
    sources: z.array(provenanceSchema),
  }),
  /** The FAA programs in force: empty when none; null when the FAA status cannot be read. */
  faa: z.object({
    programs: z.array(airportProgramSchema).nullable(),
    provenance: provenanceSchema,
  }),
  /** To show wherever the board is shown. */
  attribution: z.array(text).min(1),
});

export type AirportBoard = z.infer<typeof airportBoardSchema>;
