import { z } from 'zod';

import { provenanceSchema } from './sources.js';
import { instantSchema } from './time.js';

/**
 * Every way of moving through the city that Explore shows. Vehicles move; bike stations, train
 * stations with their next arrivals, parked scooters and bikes and airports stay where they are.
 */
const VEHICLE_MODES = ['bus', 'subway', 'rail', 'ferry', 'shuttle', 'aircraft', 'ship'] as const;
const PLACE_MODES = ['bike-station', 'rail-station', 'micromobility', 'airport'] as const;
export const liveModeSchema = z.enum([...VEHICLE_MODES, ...PLACE_MODES]);

export type LiveMode = z.infer<typeof liveModeSchema>;

const vehicleModeSchema = z.enum(VEHICLE_MODES);

export type VehicleMode = z.infer<typeof vehicleModeSchema>;

/** Modes that run a line with stops: shown only with their line, destination and timed stops. */
const LINE_MODES: ReadonlySet<VehicleMode> = new Set(['bus', 'subway', 'rail', 'ferry']);

export const runsLine = (mode: VehicleMode): boolean => LINE_MODES.has(mode);

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const text = z.string().min(1);
const count = z.number().int().nonnegative();
const seconds = z.number().nonnegative();
const positive = z.number().int().positive();

/** A selected vehicle's verified GTFS shape, or null when no shape is available. */
export const liveVehicleRouteSchema = z.object({
  /** Partial when only a verified shared or diverted segment is known. */
  coverage: z.enum(['full', 'partial']).optional(),
  coordinates: z
    .array(z.tuple([longitude, latitude]))
    .min(2)
    .max(100_000)
    .nullable(),
});
export type LiveVehicleRoute = z.infer<typeof liveVehicleRouteSchema>;

/**
 * Where a position comes from, as Vektia labels it:
 * - `gps`: the position the operator, the transponder or AIS has just published;
 * - `gps-plus`: estimated between two GPS reports, from the last one;
 * - `predicted`: no GPS; placed on its line with the predicted arrival times (the subway);
 * - `scheduled`: no live data, only the timetable;
 * - `multilateration` and `radar`: an aircraft placed by receivers or by a radar track (TIS-B).
 */
const BASES = ['gps', 'gps-plus', 'predicted', 'scheduled', 'multilateration', 'radar'] as const;
export const positionBasisSchema = z.enum(BASES);

export type PositionBasis = z.infer<typeof positionBasisSchema>;

export const livePositionSchema = z.object({
  lat: latitude,
  lon: longitude,
  basis: positionBasisSchema,
  /** How far the vehicle may be from this point, in metres; null while it has not been measured. */
  marginMeters: z.number().nonnegative().nullable(),
  /** The time of the data the position rests on: the GPS report or the predictions used. */
  dataTime: instantSchema,
  /** For a position placed by station, without GPS: the station and where the train is about it. */
  station: z
    .object({ id: text, name: text, status: z.enum(['stopped', 'arriving', 'heading']) })
    .nullable(),
  /** A possible stoppage: past the 95th percentile of `n` runs recorded from `from` to `to`. */
  stall: z
    .object({
      elapsedSeconds: seconds,
      usualSeconds: seconds,
      medianSeconds: seconds,
      n: positive,
      from: instantSchema,
      to: instantSchema,
      leftStop: z.object({ id: text, name: text }),
    })
    .nullable(),
});

export type LivePosition = z.infer<typeof livePositionSchema>;

/** `reported` by the operator, or `computed` by MovIQ from two positions. */
const measureBasisSchema = z.enum(['reported', 'computed']);

const speedSchema = z.object({
  kmh: z.number().nonnegative(),
  basis: measureBasisSchema,
  /** For a computed speed, the seconds between the two positions it comes from. */
  overSeconds: z.number().positive().nullable(),
});

/** A course in degrees clockwise from north. */
const bearingSchema = z.object({ degrees: z.number().min(0).lt(360), basis: measureBasisSchema });

const timedStopSchema = z
  .object({
    id: text,
    name: text,
    arrival: instantSchema.nullable(),
    departure: instantSchema.nullable(),
  })
  .refine((stop) => stop.arrival !== null || stop.departure !== null, 'A stop needs a time');

export type TimedStop = z.infer<typeof timedStopSchema>;

/** At most this many stops ahead travel with each vehicle; the last one is not always the end. */
export const STOPS_AHEAD = 3;

const icao = z.string().regex(/^[A-Z0-9]{3,4}$/);

export const liveVehicleSchema = z
  .object({
    /** Stable while the vehicle runs: `<mode>:<operator id>`. */
    id: text,
    mode: vehicleModeSchema,
    /** The source of its position, one of `sources`. */
    sourceId: text,
    /** The operator's trip ID in this exact vehicle snapshot, when reported. */
    tripId: text.optional(),
    /** Fleet number, flight or ship name, when the source gives one. */
    name: text.nullable(),
    /** Who runs it, for the modes of many operators (shuttles); null otherwise. */
    operator: text.nullable(),
    line: z.object({ id: text, name: text, longName: z.string().nullable() }).nullable(),
    /**
     * `timetable`: the headsign of its trip; `last-stop`: the last stop it is predicted to serve;
     * `reported`: as its crew or transponder sends it.
     */
    destination: z
      .object({ name: text, basis: z.enum(['timetable', 'last-stop', 'reported']) })
      .nullable(),
    position: livePositionSchema,
    bearing: bearingSchema.nullable(),
    speed: speedSchema.nullable(),
    /** Aircraft only; null for every other mode, and on the ground. */
    altitudeMeters: z.number().nullable(),
    /** Aircraft only: true while it reports being on the ground; null for every other mode. */
    onGround: z.boolean().nullable(),
    /** Aircraft only: the airports its callsign usually flies (ICAO), never today's flight plan. */
    usualRoute: z.array(icao).min(2).nullable(),
    /** Ships only: the AIS ship type code (ITU-R M.1371), such as 60 to 69 for passengers. */
    shipType: z.number().int().min(0).max(255).nullable(),
    /** People on board and room, by the vehicle's own counter; null where it counts none. */
    occupancy: z.object({ passengers: count, capacity: positive }).nullable(),
    /** The next stops, in travel order, with the predicted times of this very vehicle. */
    stops: z.array(timedStopSchema).max(STOPS_AHEAD),
    /** Ahead of (negative) or behind its timetable, as the operator gives it. */
    delaySeconds: z.number().int().nullable(),
  })
  .superRefine((vehicle, context) => {
    const issue = (message: string) => {
      context.addIssue({ code: 'custom', message });
    };
    const aloft = [vehicle.altitudeMeters, vehicle.onGround, vehicle.usualRoute];
    if (vehicle.mode !== 'aircraft' && aloft.some((value) => value !== null)) {
      issue('Only an aircraft has an altitude, a place on the ground and a usual route');
    }
    if (vehicle.mode !== 'ship' && vehicle.shipType !== null) issue('Only a ship has a ship type');
    if (!runsLine(vehicle.mode)) return;
    if (vehicle.line === null || vehicle.destination === null || vehicle.stops.length === 0) {
      issue('A vehicle on a line is shown only with its line, destination and timed stops');
    }
  });

export type LiveVehicle = z.infer<typeof liveVehicleSchema>;

const duration = z.object({ text: z.string(), minutes: count.nullable() }).nullable();
const note = z.string().nullable();

/** An FAA program in force at an airport, with its words as the FAA writes them. */
export const airportProgramSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ground-stop'), reason: note, until: note }),
  z.object({ kind: z.literal('ground-delay'), reason: note, average: duration, maximum: duration }),
  z.object({
    kind: z.literal('delay'),
    direction: z.enum(['arrival', 'departure']),
    reason: note,
    minimum: duration,
    maximum: duration,
    trend: note,
  }),
  z.object({ kind: z.literal('closure'), reason: note, from: note, reopens: note }),
]);

export type AirportProgram = z.infer<typeof airportProgramSchema>;

/** What every place with a live state has: where it is, its name and the source of its state. */
const place = { id: text, sourceId: text, name: text, lat: latitude, lon: longitude };

export const liveStationSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('bike-station'),
    ...place,
    bikes: count,
    /** Electric bikes among `bikes`, when the operator tells them apart. */
    ebikes: count.nullable(),
    docks: count,
    renting: z.boolean(),
    returning: z.boolean(),
    reportedAt: instantSchema,
  }),
  z.object({
    mode: z.literal('rail-station'),
    ...place,
    /** The railway it belongs to, such as `PATH`. */
    network: text,
    /** The next trains announced, soonest first, each with when the operator computed it. */
    arrivals: z.array(
      z.object({ headsign: text, arrival: instantSchema, updatedAt: instantSchema }),
    ),
    updatedAt: instantSchema,
  }),
  z.object({
    mode: z.literal('micromobility'),
    /** `name` is the operator; the vehicle stands parked where it was left, by its own GPS. */
    ...place,
    kind: z.enum(['scooter', 'e-bike', 'bike']).nullable(),
    rangeMeters: z.number().nonnegative().nullable(),
    battery: z.number().min(0).max(1).nullable(),
    /** False when the operator gives new ids in every answer: drawn anew, never followed. */
    stableId: z.boolean(),
    /** Its own report, or the time of the operator's file when it gives none per vehicle. */
    reportedAt: instantSchema,
  }),
  z.object({
    mode: z.literal('airport'),
    ...place,
    /** IATA code, such as `JFK`. */
    code: z.string().min(3).max(4),
    /** The FAA programs in force; empty when the FAA reports none at this airport. */
    programs: z.array(airportProgramSchema),
    updatedAt: instantSchema,
  }),
]);

export type LiveStation = z.infer<typeof liveStationSchema>;

/** Why a vehicle the operator reports is not on the map. */
export const exclusionReasonSchema = z.enum([
  'no-line',
  'no-destination',
  'no-predictions',
  'no-stops-ahead',
  'no-position',
  'stale-position',
  'not-departed',
  'not-in-service',
]);

export type ExclusionReason = z.infer<typeof exclusionReasonSchema>;

/**
 * - `live`: every source of the mode is healthy;
 * - `degraded`: something is shown, but a source of the mode is late, stale or down;
 * - `unavailable`: its live sources have no usable data, so nothing of it is shown;
 * - `not-connected`: MovIQ has no source for this mode yet.
 */
export const modeStatusSchema = z.enum(['live', 'degraded', 'unavailable', 'not-connected']);

export type ModeStatus = z.infer<typeof modeStatusSchema>;

export const modeSummarySchema = z.object({
  mode: liveModeSchema,
  status: modeStatusSchema,
  /** Shown in the whole city; the lists below hold only those inside the box asked for. */
  shown: count,
  excluded: z.array(z.object({ reason: exclusionReasonSchema, count: positive })),
  sourceIds: z.array(text),
});

export type ModeSummary = z.infer<typeof modeSummarySchema>;

export const liveSourceSchema = z.object({
  title: text,
  attribution: text,
  /**
   * `static`: a file in force until the provider replaces it, such as a timetable, whose age is
   * when it was published, not a delay; `realtime`: data whose age is how late it is.
   */
  kind: z.enum(['static', 'realtime']),
  /**
   * The day the provider published the static file in force, by its own date; null for live data
   * and for files the provider does not date, whose `dataTime` is when MovIQ received them.
   */
  publishedAt: instantSchema.nullable(),
  provenance: provenanceSchema,
});

export type LiveSource = z.infer<typeof liveSourceSchema>;

/** West, south, east and north, in degrees. */
export const boundingBoxSchema = z
  .tuple([longitude, latitude, longitude, latitude])
  .refine(([west, south, east, north]) => west < east && south < north, 'An empty box');

export type BoundingBox = z.infer<typeof boundingBoxSchema>;

export const liveVehiclesResponseSchema = z.object({
  generatedAt: instantSchema,
  bbox: boundingBoxSchema.nullable(),
  modes: z.array(modeSummarySchema),
  vehicles: z.array(liveVehicleSchema),
  stations: z.array(liveStationSchema),
  sources: z.array(liveSourceSchema),
});

export type LiveVehiclesResponse = z.infer<typeof liveVehiclesResponseSchema>;

/** An open screen asks the platform to read the sources of these modes quickly for a while. */
export const liveInterestRequestSchema = z.object({
  modes: z.array(liveModeSchema).min(1).max(liveModeSchema.options.length),
});

export const liveInterestResponseSchema = z.object({
  sourceIds: z.array(text),
  expiresAt: instantSchema,
});

export type LiveInterestResponse = z.infer<typeof liveInterestResponseSchema>;
