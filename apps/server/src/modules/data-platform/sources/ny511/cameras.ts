import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { decodeJson, describeIssue, refuse } from '../city/parsing.js';
import { DAY, HOUR, MINUTE, count } from '../mta/provider.js';
import { updatedAt } from './events.js';
import { NY511_API, NY511_LICENCE, NY511_PROVIDER, inCityArea, ny511Failures } from './provider.js';

const cameraFeatureSchema = z.object({
  geometry: z.object({
    type: z.literal('Point'),
    coordinates: z.tuple([z.number(), z.number()]),
  }),
  properties: z.object({
    id: z.number().int(),
    name: z.string().min(1),
    route: z.string(),
    public: z.boolean(),
    lastUpdated: z.number().int().positive(),
    cameraOwner: z.string().min(1),
    views: z.array(
      z.object({
        name: z.string(),
        type: z.string().min(1),
        url: z.url(),
        videoPreviewUrl: z.url().optional(),
        broken: z.boolean(),
      }),
    ),
  }),
});

const camerasBodySchema = z.object({ features: z.array(cameraFeatureSchema) });

/** 511NY's view types: a still picture, or live video (HLS) with a still preview. */
const VIEW_KINDS = { STILL_IMAGE: 'still', WMP: 'video' } as const;

const viewSchema = z.object({
  name: z.string(),
  kind: z.enum(['still', 'video']),
  /** The address of the picture or of the video playlist; never fetched or stored here. */
  url: z.url(),
  /** A still of the video, when there is one. */
  previewUrl: z.url().nullable(),
  broken: z.boolean(),
});

const cameraSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  road: z.string(),
  /** `NYSDOT` or `NYC DOT`. */
  owner: z.string().min(1),
  /** When 511NY last changed the camera's record, not the time of a picture. */
  updatedAt: instantSchema.nullable(),
  views: z.array(viewSchema).min(1),
  point: z.tuple([z.number(), z.number()]),
});

const camerasSchema = z.object({
  readAt: instantSchema,
  statewide: z.number().int().nonnegative(),
  cameras: z.array(cameraSchema),
});

export type TrafficCameras = z.infer<typeof camerasSchema>;
type CameraFeature = z.infer<typeof cameraFeatureSchema>;
type View = z.infer<typeof viewSchema>;

/** 2,901 cameras statewide on 11/11/2026. */
const MINIMUM_STATEWIDE = 1_500;

function viewsOf(feature: CameraFeature): View[] {
  return feature.properties.views.flatMap((view) => {
    const kind = view.type === 'STILL_IMAGE' || view.type === 'WMP' ? VIEW_KINDS[view.type] : null;
    if (kind === null) return [];
    const preview = view.videoPreviewUrl ?? null;
    return [
      {
        name: view.name,
        kind,
        url: view.url,
        previewUrl: preview === view.url ? null : preview,
        broken: view.broken,
      },
    ];
  });
}

function parseCameras(body: Uint8Array, receivedAt: Date): ParseResult<TrafficCameras> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const parsed = camerasBodySchema.safeParse(decoded.value);
  if (!parsed.success) return refuse('unexpected-shape', describeIssue(parsed.error));
  const features = parsed.data.features;
  const cameras = features
    .filter((feature) => feature.properties.public && inCityArea(feature.geometry.coordinates))
    .flatMap((feature) => {
      const views = viewsOf(feature);
      if (views.length === 0) return [];
      const { properties } = feature;
      return [
        {
          id: String(properties.id),
          name: properties.name,
          road: properties.route,
          owner: properties.cameraOwner,
          updatedAt: updatedAt(properties.lastUpdated, receivedAt),
          views,
          point: feature.geometry.coordinates,
        },
      ];
    });
  const video = cameras.filter((camera) => camera.views.some((view) => view.kind === 'video'));
  return {
    ok: true,
    data: { readAt: toInstant(receivedAt), statewide: features.length, cameras },
    dataTime: receivedAt,
    coverage: `${count(cameras.length, 'cameras')} in the city area, ${String(video.length)} with video`,
  };
}

/**
 * The list of traffic cameras of NYSDOT and NYC DOT: place, owner, the time of the record and
 * the addresses of each picture and video. Pictures are never downloaded or kept: they may show
 * people and number plates, and the product asks a picture only while a camera is open. On
 * 11/11/2026, 2,901 statewide and 1,408 in the city area (1,076 of NYC DOT, 332 of NYSDOT);
 * the newest record had changed 6 days before. 511NY's map asks every 6 minutes; the list
 * changes over days, so every 6 hours.
 */
export const ny511Cameras: SourceDefinition<TrafficCameras> = {
  id: 'ny511-cameras',
  title: '511NY traffic cameras',
  provider: NY511_PROVIDER,
  licence: NY511_LICENCE,
  kind: 'static',
  rhythm: { class: 'cold', baseIntervalMs: 6 * HOUR },
  freshness: { degradedAfterMs: DAY, staleAfterMs: 3 * DAY, unavailableAfterMs: 14 * DAY },
  limits: { timeoutMs: 2 * MINUTE, maxBytes: 16 * 1024 * 1024 },
  dataTimeSource: 'receipt',
  keepVersions: 2,
  dataSchema: camerasSchema,
  request() {
    return { url: `${NY511_API}cameras/map-features`, headers: { accept: 'application/json' } };
  },
  parse(body, { receivedAt }) {
    return parseCameras(body, receivedAt);
  },
  check(data) {
    return data.statewide < MINIMUM_STATEWIDE
      ? [`${String(data.statewide)} cameras statewide, minimum ${String(MINIMUM_STATEWIDE)}`]
      : [];
  },
  consumers: ['live-map'],
  failures: ny511Failures(`Fewer than ${String(MINIMUM_STATEWIDE)} cameras in the whole state`),
};
