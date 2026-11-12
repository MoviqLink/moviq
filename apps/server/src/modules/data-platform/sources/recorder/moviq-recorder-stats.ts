import { recorderStatsSchema, type RecorderStats } from '@moviq/contracts';

import type { SourceDefinition } from '../../definition.js';
import { decodeJson, describeIssue, olderThanServed, refuse } from '../city/parsing.js';
import { DAY, HOUR, MINUTE, count } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';

const README = 'apps/recorder-cf/README.md';

/**
 * The statistics of MovIQ's own recorder on Cloudflare (`apps/recorder-cf`): for the last New
 * York day it reduced, run times by segment, headways, the error of the providers' predictions,
 * stoppages with their proof and incident durations, each with its count. It publishes once a
 * night after 04:00 in New York; an hourly look finds it within the hour. The address and the
 * read key are the integration `moviq-recorder`.
 */
export const recorderStatsSource: SourceDefinition<RecorderStats> = {
  id: 'moviq-recorder-stats',
  title: 'MovIQ recorder statistics (Cloudflare)',
  provider: 'MovIQ recorder on Cloudflare, from the sources it records',
  licence: {
    name: 'Measured by MovIQ from the recorded sources, under their licences',
    url: README,
    attribution: 'Reliability measured by MovIQ from MTA and city open data',
  },
  kind: 'static',
  rhythm: { class: 'cold', baseIntervalMs: HOUR },
  freshness: { degradedAfterMs: 30 * HOUR, staleAfterMs: 2 * DAY, unavailableAfterMs: 8 * DAY },
  limits: { timeoutMs: MINUTE, maxBytes: 32 * 1024 * 1024 },
  integration: 'moviq-recorder',
  keepVersions: 3,
  dataSchema: recorderStatsSchema,
  request({ credentials }) {
    const base = (credentials['RECORDER_URL'] ?? '').replace(/\/+$/, '');
    const token = credentials['RECORDER_READ_TOKEN'] ?? '';
    return {
      url: `${base}/stats/latest`,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    };
  },
  parse(body) {
    const decoded = decodeJson(body);
    if (!decoded.ok) return decoded;
    const parsed = recorderStatsSchema.safeParse(decoded.value);
    if (!parsed.success) return refuse('schema-mismatch', describeIssue(parsed.error));
    const stats = parsed.data;
    const coverage =
      `${stats.day}: ${count(stats.segments.length, 'segments')}, ` +
      `${count(stats.predictions.length, 'prediction bands')}, ` +
      (stats.complete ? 'complete' : 'incomplete');
    return { ok: true, data: stats, dataTime: new Date(stats.generatedAt), coverage };
  },
  check(data, previous) {
    return olderThanServed(data.generatedAt, previous?.generatedAt);
  },
  consumers: ['trip-planning', 'trip-watch', 'sara-briefing'],
  failures: httpFailures('the recorder on Cloudflare', README),
};
