import { toInstant } from '@moviq/contracts';
import { z } from 'zod';
import type { ParseResult, SourceDefinition } from '../../definition.js';
import { DAY, MINUTE } from '../mta/provider.js';
import { NYC_OPEN_DATA, nycOpenDataLicence, readRows, socrataFailures } from './socrata.js';

const rowSchema = z.object({
  lpc_lpnumb: z.string().trim().min(1),
  lpc_name: z.string().trim().min(1),
  lpc_sitest: z.string().optional(),
  address: z.string().optional(),
  borough: z.string().optional(),
  desdate: z.string().optional(),
  latitude: z.string().transform(Number).pipe(z.number().min(40.4).max(41)),
  longitude: z.string().transform(Number).pipe(z.number().min(-74.3).max(-73.6)),
});
const landmarkSchema = z.object({
  id: z.string(),
  name: z.string(),
  point: z.tuple([z.number(), z.number()]),
  address: z.string().nullable(),
  borough: z.string().nullable(),
  designatedOn: z.iso.date().nullable(),
});
const landmarksSchema = z.object({
  readAt: z.iso.datetime(),
  landmarks: z.array(landmarkSchema),
  leftOut: z.number().int().nonnegative(),
});
type Landmarks = z.infer<typeof landmarksSchema>;
const clean = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
};
/** LPC dates are US calendar dates, not instants. Invalid dates are left unspecified. */
function designation(value: string | undefined): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value ?? '');
  if (match === null) return null;
  const date = `${match[3]}-${match[1]?.padStart(2, '0')}-${match[2]?.padStart(2, '0')}`;
  const parsed = z.iso.date().safeParse(date);
  return parsed.success ? parsed.data : null;
}
function parseLandmarks(body: Uint8Array, receivedAt: Date): ParseResult<Landmarks> {
  const read = readRows(body, rowSchema);
  if (!('rows' in read)) return read;
  const seen = new Set<string>();
  const landmarks = read.rows
    .filter((row) => row.lpc_sitest === 'Designated')
    .map((row) => ({
      id: `${row.lpc_lpnumb}:${String(row.longitude)},${String(row.latitude)}`,
      name: row.lpc_name,
      point: [row.longitude, row.latitude] as [number, number],
      address: clean(row.address),
      borough: clean(row.borough),
      designatedOn: designation(row.desdate),
    }))
    .filter((item) => !seen.has(item.id) && seen.add(item.id));
  return {
    ok: true,
    data: { readAt: toInstant(receivedAt), landmarks, leftOut: read.leftOut },
    dataTime: receivedAt,
    coverage: `${String(landmarks.length)} designated landmarks, ${String(read.leftOut)} incomplete rows`,
  };
}
export const nycLandmarks: SourceDefinition<Landmarks> = {
  id: 'nyc-landmarks',
  title: 'NYC individual landmarks',
  provider: 'NYC Landmarks Preservation Commission (NYC Open Data)',
  licence: nycOpenDataLicence(
    'NYC Landmarks Preservation Commission, Individual Landmark Sites (buis-pvji)',
  ),
  kind: 'static',
  rhythm: { class: 'cold', baseIntervalMs: DAY },
  freshness: { degradedAfterMs: 3 * DAY, staleAfterMs: 14 * DAY, unavailableAfterMs: 60 * DAY },
  limits: { timeoutMs: 2 * MINUTE, maxBytes: 4 * 1024 * 1024 },
  dataTimeSource: 'receipt',
  keepVersions: 2,
  dataSchema: landmarksSchema,
  request() {
    return {
      url:
        `${NYC_OPEN_DATA}buis-pvji.json?` +
        '$select=lpc_name,lpc_lpnumb,desdate,borough,address,latitude,longitude,lpc_sitest&' +
        '$order=lpc_lpnumb,latitude&$limit=5000',
    };
  },
  parse(body, { receivedAt }) {
    return parseLandmarks(body, receivedAt);
  },
  check(data) {
    return data.landmarks.length < 1000
      ? [`${String(data.landmarks.length)} landmarks, minimum 1000`]
      : [];
  },
  consumers: ['live-map'],
  failures: socrataFailures(
    'data.cityofnewyork.us',
    'Fewer than 1000 designated landmarks with coordinates',
  ),
};
