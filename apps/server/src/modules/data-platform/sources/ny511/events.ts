import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult } from '../../definition.js';
import { decodeJson, describeIssue, refuse, type Refusal } from '../city/parsing.js';
import { aheadOf, geometrySchema, plainText, touchesCityArea } from './provider.js';

const epoch = z.object({ time: z.number().int().positive() });

/** One feature of an `events/map-features` layer of 511NY, with the fields read. */
const eventFeatureSchema = z.object({
  geometry: geometrySchema,
  properties: z.object({
    id: z.string().min(1),
    /** `critical`, `urgent`, `routine` or `standard`: how 511NY ranks it. */
    eventType: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    updated: z.number().int().positive(),
    route: z.string().optional(),
    /** Whether the event applies now, by 511NY's own schedule. */
    active: z.boolean(),
    startTime: epoch.nullish(),
    fromTo: z.string().optional(),
    eventReport: z.object({
      eventDescription: z.object({
        headlinePhrase: z.string().min(1),
        locationDescription: z.string().optional(),
      }),
      agencyAttribution: z.object({ agencyName: z.string().min(1) }),
      location: z.object({ locationName: z.string().optional() }).optional(),
      scheduleOccurrences: z.array(z.object({ startTime: epoch, endTime: epoch.nullish() })),
    }),
  }),
});

const layerBodySchema = z.object({ features: z.array(eventFeatureSchema) });

type EventFeature = z.infer<typeof eventFeatureSchema>;

/** The features of a layer that touch the city area, and how many the whole state had. */
export interface EventFeatures {
  readonly statewide: number;
  readonly inArea: readonly EventFeature[];
}

export function readEventFeatures(body: Uint8Array): EventFeatures | Refusal {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const parsed = layerBodySchema.safeParse(decoded.value);
  if (!parsed.success) return refuse('unexpected-shape', describeIssue(parsed.error));
  const features = parsed.data.features;
  return {
    statewide: features.length,
    inArea: features.filter((feature) => touchesCityArea(feature.geometry)),
  };
}

/** The time 511NY last updated an item, or null when its clock put it ahead of ours. */
export function updatedAt(updated: number, receivedAt: Date): string | null {
  return aheadOf(updated, receivedAt) ? null : toInstant(new Date(updated));
}

const periodSchema = z.object({ from: instantSchema, to: instantSchema.nullable() });

const roadEventSchema = z.object({
  /** TRANSCOM's id, such as `TRANSCOM-ORC300605835`. */
  id: z.string().min(1),
  /** The agency 511NY credits with the event. */
  agency: z.string().min(1),
  severity: z.string().min(1),
  /** 511NY's own words for what happens (`Road Closed`, `Crash`, `Concert`). */
  headline: z.string().min(1),
  title: z.string().min(1),
  /** The description as published, without its HTML markup. */
  description: z.string(),
  road: z.string().nullable(),
  place: z.string().nullable(),
  active: z.boolean(),
  startsAt: instantSchema.nullable(),
  /** The periods 511NY lists; often none, and then the description gives the days and hours. */
  periods: z.array(periodSchema),
  /** Shown with the event, as the access agreement asks; null when 511NY's clock was ahead. */
  updatedAt: instantSchema.nullable(),
  geometry: geometrySchema,
});

export const roadEventLayerSchema = z.object({
  /** When the layer was read: the layer itself carries no time. */
  readAt: instantSchema,
  /** Events in the whole state before the cut to the city area. */
  statewide: z.number().int().nonnegative(),
  events: z.array(roadEventSchema),
});

export type RoadEventLayer = z.infer<typeof roadEventLayerSchema>;

function toRoadEvent(feature: EventFeature, receivedAt: Date): z.infer<typeof roadEventSchema> {
  const { properties } = feature;
  const report = properties.eventReport;
  const start = properties.startTime?.time;
  return {
    id: properties.id,
    agency: report.agencyAttribution.agencyName,
    severity: properties.eventType,
    headline: report.eventDescription.headlinePhrase,
    title: properties.title,
    description: plainText(properties.description),
    road: properties.route ?? null,
    place: report.eventDescription.locationDescription ?? report.location?.locationName ?? null,
    active: properties.active,
    startsAt: start === undefined ? null : toInstant(new Date(start)),
    periods: report.scheduleOccurrences.map((occurrence) => ({
      from: toInstant(new Date(occurrence.startTime.time)),
      to: occurrence.endTime ? toInstant(new Date(occurrence.endTime.time)) : null,
    })),
    updatedAt: updatedAt(properties.updated, receivedAt),
    geometry: feature.geometry,
  };
}

export function parseRoadEvents(body: Uint8Array, receivedAt: Date): ParseResult<RoadEventLayer> {
  const read = readEventFeatures(body);
  if (!('inArea' in read)) return read;
  const events = read.inArea.map((feature) => toRoadEvent(feature, receivedAt));
  const active = events.filter((event) => event.active).length;
  return {
    ok: true,
    data: { readAt: toInstant(receivedAt), statewide: read.statewide, events },
    dataTime: receivedAt,
    coverage: [
      `${String(events.length)} in the city area of ${String(read.statewide)} statewide`,
      `${String(active)} active now`,
    ].join(', '),
  };
}
