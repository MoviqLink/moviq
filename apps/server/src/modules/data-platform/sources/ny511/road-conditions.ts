import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { HOUR, MINUTE, count } from '../mta/provider.js';
import { readEventFeatures, updatedAt } from './events.js';
import {
  NY511_API,
  NY511_LICENCE,
  NY511_PROVIDER,
  geometrySchema,
  ny511Failures,
} from './provider.js';

const segmentSchema = z.object({
  /** NYSDOT's segment id, such as `NYSDOTSEG-5680`. */
  id: z.string().min(1),
  road: z.string().min(1),
  /** The ends of the segment, as `US 9W to NY 23A`. */
  between: z.string().nullable(),
  /**
   * NYSDOT's words for the surface, unchanged: `Generally Clear And Dry`, a snow or ice phrase,
   * or `No Active Reporting` and `Update Pending`, which say nothing about the road.
   */
  condition: z.string().min(1),
  updatedAt: instantSchema.nullable(),
  geometry: geometrySchema,
});

const roadConditionsSchema = z.object({
  readAt: instantSchema,
  statewide: z.number().int().nonnegative(),
  segments: z.array(segmentSchema),
});

export type RoadConditions = z.infer<typeof roadConditionsSchema>;

/** 505 segments statewide on 11/11/2026; NYSDOT reports every segment, snow or not. */
const MINIMUM_STATEWIDE = 200;

function parseConditions(body: Uint8Array, receivedAt: Date): ParseResult<RoadConditions> {
  const read = readEventFeatures(body);
  if (!('inArea' in read)) return read;
  const segments = read.inArea.map((feature) => ({
    id: feature.properties.id,
    road: feature.properties.route ?? feature.properties.title,
    between: feature.properties.fromTo ?? null,
    condition: feature.properties.eventReport.eventDescription.headlinePhrase,
    updatedAt: updatedAt(feature.properties.updated, receivedAt),
    geometry: feature.geometry,
  }));
  const reporting = segments.filter(
    (segment) => !['No Active Reporting', 'Update Pending'].includes(segment.condition),
  ).length;
  return {
    ok: true,
    data: { readAt: toInstant(receivedAt), statewide: read.statewide, segments },
    dataTime: receivedAt,
    coverage: `${count(segments.length, 'segments')} in the city area, ${String(reporting)} reporting`,
  };
}

/**
 * Winter driving conditions of NYSDOT road segments: whether the surface is clear, wet, snowy
 * or icy. The National Weather Service (`city/nws-*`) gives the weather, not the road, so this
 * adds to it. On 11/11/2026, 505 segments statewide (9.8 MB, 215,000 points) and 44 in the city
 * area: 38 "Generally Clear And Dry" statewide, the rest without a report. 511NY's map asks every
 * minute; the surface changes over tens of minutes, so every 15, every 5 while a trip is watched.
 */
export const ny511RoadConditions: SourceDefinition<RoadConditions> = {
  id: 'ny511-road-conditions',
  title: '511NY winter road conditions',
  provider: NY511_PROVIDER,
  licence: NY511_LICENCE,
  kind: 'realtime',
  rhythm: { class: 'warm', baseIntervalMs: 15 * MINUTE, interestIntervalMs: 5 * MINUTE },
  freshness: { degradedAfterMs: HOUR, staleAfterMs: 3 * HOUR, unavailableAfterMs: 12 * HOUR },
  limits: { timeoutMs: 60_000, maxBytes: 32 * 1024 * 1024 },
  dataTimeSource: 'receipt',
  keepVersions: 1,
  dataSchema: roadConditionsSchema,
  request() {
    return {
      url: `${NY511_API}events/map-features?eventClassifications=winterDriving`,
      headers: { accept: 'application/json' },
    };
  },
  parse(body, { receivedAt }) {
    return parseConditions(body, receivedAt);
  },
  check(data) {
    return data.statewide < MINIMUM_STATEWIDE
      ? [`${String(data.statewide)} segments statewide, minimum ${String(MINIMUM_STATEWIDE)}`]
      : [];
  },
  consumers: ['weather', 'live-map'],
  failures: ny511Failures(`Fewer than ${String(MINIMUM_STATEWIDE)} segments in the whole state`),
};
