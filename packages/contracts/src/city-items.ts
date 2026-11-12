import { z } from 'zod';

import { restroomFactsSchema } from './restrooms.js';
import { instantSchema } from './time.js';

/**
 * The groups of the city layers in Explore's panel; `transport` sits with the modes of transport,
 * which are not city layers.
 */
export const cityGroupSchema = z.enum(['transport', 'street', 'places', 'harbor', 'weather']);

export type CityGroup = z.infer<typeof cityGroupSchema>;

/** Every city layer MovIQ serves, in the order of the panel. */
export const cityLayerIdSchema = z.enum([
  'transit-alerts',
  'incidents',
  'closures',
  'construction',
  'street-permits',
  'permitted-events',
  'cameras',
  'chargers',
  'defibrillators',
  'restrooms',
  'landmarks',
  'subway-entrances',
  'parking-meters',
  'parking-signs',
  'vessel-calls',
  'harbor-conditions',
  'coast-guard',
  'road-conditions',
  'weather-alerts',
]);

export type CityLayerId = z.infer<typeof cityLayerIdSchema>;

const text = z.string().min(1);
/** An optional field as the source gives it; empty or null when it gives nothing. */
const note = z.string().nullable();
const count = z.number().int().nonnegative();
const instant = instantSchema;
const day = z.iso.date();

/** Longitude and latitude, in that order, as GeoJSON writes them. */
const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

/** A 511NY road event: an incident, a closure, works, a transit or special event, a warning. */
const roadEvent = z.object({
  kind: z.literal('road-event'),
  /** 511NY's own words for what happens (`Road Closed`, `Crash`). */
  headline: text,
  /** The agency 511NY credits with the event. */
  agency: text,
  description: z.string(),
  road: note,
  place: note,
  /** Whether it applies now, by 511NY's own schedule. */
  active: z.boolean(),
  startsAt: instant.nullable(),
  periods: z.array(z.object({ from: instant, to: instant.nullable() })),
  /** The time 511NY last updated it, shown with it; null when 511NY's clock ran ahead. */
  updatedAt: instant.nullable(),
});

/** A block closed today for construction (NYC DOT), with days and no hours. */
const streetClosure = z.object({
  kind: z.literal('street-closure'),
  street: text,
  from: note,
  to: note,
  borough: text,
  purpose: note,
  firstDay: day,
  lastDay: day,
});

/** An event with a permit today (NYC): a place in words, its closure when it has one. */
const permittedEvent = z.object({
  kind: z.literal('permitted-event'),
  type: text,
  agency: text,
  borough: text,
  location: text,
  side: note,
  /** As published, such as `Full Street Closure`; null when the permit closes nothing. */
  closure: note,
  /** The start of its first stretch in force today: an earlier day for a permit of months. */
  startsAt: instant,
  /** The end of its last stretch in force today. */
  endsAt: instant,
  /** Each stretch in force today, earliest first, as the dataset lists them; nearly always one. */
  stretches: z.array(z.object({ startsAt: instant, endsAt: instant })).min(1),
});

/** A traffic camera of NYSDOT or NYC DOT; its picture is asked through MovIQ only. */
const camera = z.object({
  kind: z.literal('camera'),
  owner: text,
  road: z.string(),
  /** True when the list gives a still picture, asked at `/api/city/cameras/<id>/image`. */
  picture: z.boolean(),
  /** The live video (HLS) of the owner, opened only when the traveller asks for it. */
  videoUrl: z.url({ protocol: /^https$/ }).nullable(),
  /** When 511NY last changed the camera's record: not the time of a picture. */
  recordUpdatedAt: instant.nullable(),
});

/** A charging station as listed by the AFDC: never free or in use. */
const charger = z.object({
  kind: z.literal('charger'),
  address: text,
  listing: z.enum(['open', 'planned', 'temporarily-unavailable']),
  access: note,
  hours: note,
  ports: z.object({ level1: count, level2: count, fast: count }),
  network: note,
  connectors: z.array(text),
  pricing: note,
  confirmedOn: day.nullable(),
});

/** A registered defibrillator: building, place inside and units, with no hours. */
const defibrillator = z.object({
  kind: z.literal('defibrillator'),
  address: text,
  place: note,
  units: count.nullable(),
  locationType: note,
  updatedOn: day.nullable(),
});

/** A public restroom in service, free, with its hours as published. */
const restroom = restroomFactsSchema.extend({ kind: z.literal('restroom') });

const landmark = z.object({
  kind: z.literal('landmark'),
  address: note,
  borough: note,
  designatedOn: day.nullable(),
});

/** A subway entrance of the MTA's 2024 survey. */
const subwayEntrance = z.object({
  kind: z.literal('subway-entrance'),
  /** As the survey names it: `Stair`, `Elevator`, `Escalator`, `Ramp` and others. */
  type: text,
  entry: z.boolean(),
  exit: z.boolean(),
});

/** A parking meter in service: its printed rules, never whether a space is free. */
const parkingMeter = z.object({
  kind: z.literal('parking-meter'),
  hours: note,
  facility: z.enum(['on-street', 'off-street']).nullable(),
  street: note,
  side: note,
  from: note,
  to: note,
});

/** A parking sign with its text as DOT lists it: never worked out into "allowed now". */
const parkingSign = z.object({
  kind: z.literal('parking-sign'),
  code: text,
  text,
  street: note,
  side: note,
  arrow: note,
  since: day.nullable(),
});

/** A call of a ship at Port Newark Container Terminal. */
const vesselCall = z.object({
  kind: z.literal('vessel-call'),
  line: note,
  expectedArrival: instant.nullable(),
  arrived: instant.nullable(),
  expectedDeparture: instant.nullable(),
  departed: instant.nullable(),
  stage: z.enum(['announced', 'at-berth', 'departed']),
});

const flagged = z.boolean();

/** The latest NOAA PORTS measurement of a station, in the units NOAA gives. */
const harborReading = z.object({
  kind: z.literal('harbor-reading'),
  observedAt: instant,
  reading: z.discriminatedUnion('measure', [
    z.object({
      measure: z.literal('water-level'),
      metresAboveChartDatum: z.number(),
      preliminary: z.boolean(),
      flagged,
    }),
    z.object({ measure: z.literal('air-gap'), metres: z.number().positive(), flagged }),
    z.object({
      measure: z.literal('current'),
      centimetresPerSecond: z.number().nonnegative(),
      directionDegrees: z.number().min(0).max(360),
    }),
    z.object({
      measure: z.literal('wind'),
      metresPerSecond: z.number().nonnegative(),
      gustMetresPerSecond: z.number().nonnegative().nullable(),
      directionDegrees: z.number().min(0).max(360),
      flagged,
    }),
  ]),
});

/** A Coast Guard broadcast notice to mariners, without its point-of-contact line. */
const notice = z.object({
  kind: z.literal('notice'),
  category: text,
  area: note,
  subject: note,
  reference: note,
  publishedAt: instant,
  endsAt: instant.nullable(),
  text: z.string(),
  link: z.url({ protocol: /^https?$/ }).nullable(),
});

/** A service alert of PATH or of a ferry, with what it names. */
const transitAlert = z.object({
  kind: z.literal('transit-alert'),
  network: text,
  text: z.string(),
  sentAt: instant.nullable(),
  /** The periods it gives; empty when it gives none. */
  periods: z.array(z.object({ from: instant.nullable(), to: instant.nullable() })),
  /** The lines, routes or stops it names, as the operator names them. */
  names: z.array(text),
  /** True once the operator closed it: resolved, or a one-off notice. */
  closed: z.boolean(),
});

/** The state of a road surface as NYSDOT words it. */
const roadCondition = z.object({
  kind: z.literal('road-condition'),
  road: text,
  between: note,
  condition: text,
  updatedAt: instant.nullable(),
});

/** A weather alert of the National Weather Service. */
const weatherAlert = z.object({
  kind: z.literal('weather-alert'),
  severity: z.enum(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']),
  headline: note,
  description: note,
  instruction: note,
  area: z.string(),
  sender: z.string(),
  startsAt: instant,
  endsAt: instant.nullable(),
  expiresAt: instant,
});

export const cityDetailSchema = z.discriminatedUnion('kind', [
  roadEvent,
  streetClosure,
  permittedEvent,
  camera,
  charger,
  defibrillator,
  restroom,
  landmark,
  subwayEntrance,
  parkingMeter,
  parkingSign,
  vesselCall,
  harborReading,
  notice,
  transitAlert,
  roadCondition,
  weatherAlert,
]);

export type CityDetail = z.infer<typeof cityDetailSchema>;

/**
 * One thing a city layer shows. `point` is where its mark is drawn and `lines` the street or road
 * it covers; an item whose source gives no place has neither and is only listed.
 */
export const cityItemSchema = z.object({
  /** `<layer>:<id at the source>`: stable while the source lists it. */
  id: text,
  layer: cityLayerIdSchema,
  sourceId: text,
  title: text,
  point: lonLat.nullable(),
  lines: z.array(z.array(lonLat).min(2)),
  detail: cityDetailSchema,
});

export type CityItem = z.infer<typeof cityItemSchema>;
