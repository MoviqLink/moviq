import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { decodeJson, describeIssue, olderThanServed, refuse } from '../city/parsing.js';
import { HOUR, MINUTE } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';

const FUTURE_TOLERANCE_MS = 2 * MINUTE;

const instantText = z.string().refine((text) => !Number.isNaN(Date.parse(text)));

const answerSchema = z.object({
  Active: z.boolean(),
  LastModified: instantText,
  NextModify: instantText,
  Now1: instantText,
});

const plowStatusSchema = z.object({
  /**
   * True while the Department of Sanitation tracks its snow vehicles (a snowfall); false the
   * rest of the year, when the map shows "PlowNYC is not tracking vehicles at this time".
   */
  tracking: z.boolean(),
  /** When PlowNYC last recomputed the streets visited, every 15 minutes. */
  computedAt: instantSchema,
  nextComputeAt: instantSchema,
  answeredAt: instantSchema,
});

export type PlowStatus = z.infer<typeof plowStatusSchema>;

function parsePlowStatus(body: Uint8Array, receivedAt: Date): ParseResult<PlowStatus> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const answer = answerSchema.safeParse(decoded.value);
  if (!answer.success) return refuse('unexpected-shape', describeIssue(answer.error));
  const computedAt = new Date(answer.data.LastModified);
  if (computedAt.getTime() - receivedAt.getTime() > FUTURE_TOLERANCE_MS) {
    return refuse('future-update', `LastModified ${toInstant(computedAt)} is after receipt.`);
  }
  return {
    ok: true,
    data: {
      tracking: answer.data.Active,
      computedAt: toInstant(computedAt),
      nextComputeAt: toInstant(new Date(answer.data.NextModify)),
      answeredAt: toInstant(new Date(answer.data.Now1)),
    },
    dataTime: computedAt,
    coverage: answer.data.Active ? 'tracking snow vehicles' : 'not tracking: no snowfall',
  };
}

/**
 * Whether PlowNYC (NYC Department of Sanitation) is tracking its plows and spreaders, read from
 * the route its public map asks every time it opens. The map adds the time in milliseconds as
 * `now`, because the answer carries a one-year `Cache-Control`; MovIQ does the same.
 *
 * During a snowfall the map shows, by street segment, how long ago a snow vehicle passed: as
 * image tiles and one point at a time, not as data. What MovIQ reads here is whether tracking is
 * on and when it was last recomputed.
 *
 * Rhythm and freshness: PlowNYC recomputes every 15 minutes (`LastModified`, `NextModify`), so
 * one read every 15 minutes; two missed recomputes degrade it.
 *
 * Terms: the map shows the City's disclaimer (the data may be inaccurate or incomplete); the
 * Open Data history (`rmhc-afj9`) declares no licence.
 */
export const plowNycSource: SourceDefinition<PlowStatus> = {
  id: 'plownyc-status',
  title: 'PlowNYC snow vehicle tracking',
  provider: 'NYC Department of Sanitation (DSNY), PlowNYC',
  licence: {
    name: 'PlowNYC disclaimer of the City of New York',
    url: 'https://plownyc.nyc.gov/plownyc/',
    attribution: 'Snow clearing data from the NYC Department of Sanitation (PlowNYC)',
  },
  kind: 'realtime',
  rhythm: { class: 'warm', baseIntervalMs: 15 * MINUTE },
  freshness: { degradedAfterMs: 35 * MINUTE, staleAfterMs: HOUR, unavailableAfterMs: 3 * HOUR },
  limits: { timeoutMs: 20_000, maxBytes: 64 * 1024 },
  keepVersions: 1,
  dataSchema: plowStatusSchema,
  request({ now }) {
    return {
      url: `https://plownyc.nyc.gov/mappingapi/api/highlight/active?now=${String(now.getTime())}`,
      headers: { accept: 'application/json' },
    };
  },
  parse(body, { receivedAt }) {
    return parsePlowStatus(body, receivedAt);
  },
  check(data, previous) {
    return olderThanServed(data.computedAt, previous?.computedAt);
  },
  consumers: ['live-map', 'road-times'],
  failures: [
    ...httpFailures('plownyc.nyc.gov', 'https://plownyc.nyc.gov/plownyc/'),
    {
      code: 'not-json',
      detection: 'The body is not JSON, such as an HTML error page of the Azure front door',
      state: 'degraded',
      remedy: 'Keep the last status with its age; the next run tries again',
    },
    {
      code: 'unexpected-shape',
      detection: 'No Active, LastModified, NextModify or Now1: the route of the map changed',
      state: 'misconfigured',
      remedy: 'Compare with the capture and the script of the PlowNYC map, then update the reader',
    },
    {
      code: 'future-update',
      detection: 'LastModified is more than 2 minutes after the download',
      state: 'degraded',
      remedy: 'Refused until the provider clock is right again',
    },
    {
      code: 'older-than-served',
      detection: 'LastModified is earlier than the one served, as from a stale cache',
      state: 'degraded',
      remedy: 'Keep the newer status; the next run normally brings a current one',
    },
  ],
};
