import { z } from 'zod';

/**
 * One line of a recording. Every line names the version it comes from (`v`) and the time of the
 * datum (`t`). Instants are whole Unix seconds and coordinates have five decimals (about 1 m),
 * which keeps a day of the city small; the database keeps ISO instants as everywhere else.
 */
const seconds = z.number().int().nonnegative();
const base = { v: z.string().min(1), t: seconds };
const direction = z.string().nullable();

/** Marks the start of the events of one admitted version. */
const versionEvent = z.object({
  k: z.literal('version'),
  ...base,
  run: z.number().int().positive(),
  at: seconds,
});

/** Admitted versions that could not be recorded: their copy was gone or no longer valid. */
const gapEvent = z.object({
  k: z.literal('gap'),
  ...base,
  fromRun: z.number().int().positive(),
  toRun: z.number().int().positive(),
  versions: z.number().int().positive(),
  first: seconds,
  why: z.string().min(1),
});

/** A vehicle starts a trip, or the trip changes its route or direction. */
const assignEvent = z.object({
  k: z.literal('assign'),
  ...base,
  veh: z.string().min(1),
  trip: z.string().min(1),
  route: z.string().min(1),
  dir: direction,
});

/** A GPS report that moved, or that names another next stop. */
const gpsEvent = z.object({
  k: z.literal('gps'),
  ...base,
  veh: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  brg: z.number().int().nullable(),
  stop: z.string().nullable(),
});

/** A vehicle keeps reporting the same place: since when, how many reports, where. */
const heldEvent = z.object({
  k: z.literal('held'),
  ...base,
  veh: z.string().min(1),
  trip: z.string().min(1),
  since: seconds,
  n: z.number().int().positive(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

/** A subway train changes the stop it is at or heading to, or its status. */
const trainEvent = z.object({
  k: z.literal('train'),
  ...base,
  trip: z.string().min(1),
  route: z.string().min(1),
  dir: direction,
  stop: z.string().nullable(),
  status: z.enum(['incoming', 'stopped', 'in-transit']).nullable(),
});

/**
 * A passage at a stop. An arrival is a train reporting itself stopped there, at the time it
 * gave (`exact`). A departure is a stop no longer listed ahead (subway feeds) or a new next
 * stop (Bus Time), observed between `lo` and `hi`; `exact` says that `t` is the time the feed
 * gave for the stop inside that window, otherwise `t` is `hi`.
 */
const stationEvent = z.object({
  k: z.literal('stn'),
  ...base,
  ev: z.enum(['arr', 'dep']),
  trip: z.string().min(1),
  route: z.string().min(1),
  dir: direction,
  veh: z.string().nullable(),
  stop: z.string().min(1),
  next: z.string().nullable(),
  lo: seconds,
  hi: seconds,
  exact: z.boolean(),
});

/** What the provider predicted at `t` for a trip at a stop, once per horizon band. */
const predictionEvent = z.object({
  k: z.literal('pred'),
  ...base,
  trip: z.string().min(1),
  route: z.string().min(1),
  stop: z.string().min(1),
  p: seconds,
});

const incidentFields = {
  ...base,
  id: z.string().min(1),
  kind: z.string().min(1),
  type: z.string().min(1),
  routes: z.array(z.string().min(1)),
  fp: z.string().min(1),
};

/** An incident appears, changes, or is no longer published (seen last at `last`). */
const openEvent = z.object({ k: z.literal('open'), ...incidentFields });
const changeEvent = z.object({ k: z.literal('change'), ...incidentFields });
const closeEvent = z.object({
  k: z.literal('close'),
  ...base,
  id: z.string().min(1),
  since: seconds,
  last: seconds,
});

/** A measured value that changed, such as the speed of a road link or a forecast hour. */
const sampleEvent = z.object({
  k: z.literal('sample'),
  ...base,
  key: z.string().min(1),
  value: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
});

export const recordedEventSchema = z.discriminatedUnion('k', [
  versionEvent,
  gapEvent,
  assignEvent,
  gpsEvent,
  heldEvent,
  trainEvent,
  stationEvent,
  predictionEvent,
  openEvent,
  changeEvent,
  closeEvent,
  sampleEvent,
]);

export type RecordedEvent = z.infer<typeof recordedEventSchema>;
export type StationEvent = z.infer<typeof stationEvent>;
export type TrainEvent = z.infer<typeof trainEvent>;
export type PredictionEvent = z.infer<typeof predictionEvent>;
export type HeldEvent = z.infer<typeof heldEvent>;
export type IncidentEvent = z.infer<typeof openEvent> | z.infer<typeof changeEvent>;
export type CloseEvent = z.infer<typeof closeEvent>;

type WithoutVersion<E> = E extends unknown ? Omit<E, 'v'> : never;

/** Event payloads as extractors build them; the recorder adds the version. */
export type ExtractedEvent = WithoutVersion<
  Exclude<RecordedEvent, { readonly k: 'version' | 'gap' }>
>;

/** Whole Unix seconds of an instant. */
export const unixSeconds = (instant: string | Date): number =>
  Math.floor((typeof instant === 'string' ? Date.parse(instant) : instant.getTime()) / 1000);

/** Five decimals of a degree, about a metre. */
export const roundCoordinate = (value: number): number => Math.round(value * 1e5) / 1e5;
