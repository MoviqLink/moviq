import type { CityItem } from '@moviq/contracts';

import { ny511Cameras, type TrafficCameras } from '../../data-platform/sources/ny511/cameras.js';
import {
  ny511Closures,
  ny511Construction,
  ny511FutureConstruction,
  ny511Incidents,
} from '../../data-platform/sources/ny511/event-layers.js';
import { nycPermittedEventsToday } from '../../data-platform/sources/street/permitted-events.js';
import { nycStreetClosuresToday } from '../../data-platform/sources/street/street-closures.js';
import { nycStreetPermitSources } from '../../data-platform/sources/street/street-permits.js';
import { NO_PLACE, placeOf, pointPlace } from '../geometry.js';
import { layerOf, part, type CityLayer } from '../layer.js';
import { roadEventPart } from './road-events.js';

type Camera = TrafficCameras['cameras'][number];

/** The still picture MovIQ asks for a camera: its own still, or the still of its video. */
export function pictureOf(camera: Camera): string | null {
  const still = camera.views.find((view) => view.kind === 'still' && !view.broken);
  if (still !== undefined) return still.url;
  const video = camera.views.find((view) => view.kind === 'video' && !view.broken);
  return video?.previewUrl ?? null;
}

/** HLS playlists only: the video is opened by the traveller, never started by the card. */
function videoOf(camera: Camera): string | null {
  const video = camera.views.find((view) => view.kind === 'video' && !view.broken);
  return video !== undefined && /^https:\/\/.+\.m3u8$/.test(video.url) ? video.url : null;
}

const cameraItems = (data: TrafficCameras): CityItem[] =>
  data.cameras.map((camera) => ({
    id: `cameras:${camera.id}`,
    layer: 'cameras',
    sourceId: ny511Cameras.id,
    title: camera.name,
    ...pointPlace(camera.point),
    detail: {
      kind: 'camera',
      owner: camera.owner,
      road: camera.road,
      picture: pictureOf(camera) !== null,
      videoUrl: videoOf(camera),
      recordUpdatedAt: camera.updatedAt,
    },
  }));

/** Incidents of 511NY now: crashes, debris, disabled vehicles, police activity. */
const incidents = layerOf('incidents', 'street', [roadEventPart('incidents', ny511Incidents)]);

/** Closures of 511NY and the blocks NYC DOT closes today for construction. */
const closures = layerOf('closures', 'street', [
  roadEventPart('closures', ny511Closures),
  part({
    source: nycStreetClosuresToday,
    items: (data): CityItem[] =>
      data.closures.map((closure) => ({
        id: `closures:${closure.id}`,
        layer: 'closures',
        sourceId: nycStreetClosuresToday.id,
        title: closure.street,
        ...placeOf(closure.geometry),
        detail: {
          kind: 'street-closure',
          street: closure.street,
          from: closure.from,
          to: closure.to,
          borough: closure.borough,
          purpose: closure.purpose,
          firstDay: closure.firstDay,
          lastDay: closure.lastDay,
        },
      })),
  }),
]);

/** Works of 511NY going on now and those that begin in two days or more. */
const construction = layerOf('construction', 'street', [
  roadEventPart('construction', ny511Construction),
  roadEventPart('construction', ny511FutureConstruction),
]);

/**
 * Street permits in force today, by borough. A permit is a window in which work is allowed, and
 * the dataset places it by street name only: counted, never drawn, and never a closure.
 */
const streetPermits = layerOf(
  'street-permits',
  'street',
  nycStreetPermitSources.map((source) =>
    part({
      source,
      items: () => [],
      tally: (data) => ({ label: data.borough, count: data.permits.length }),
    }),
  ),
);

/** Events with a permit today, placed in words, with the closure each permit gives. */
const permittedEvents = layerOf('permitted-events', 'street', [
  part({
    source: nycPermittedEventsToday,
    items: (data): CityItem[] =>
      data.events.map((event) => ({
        id: `permitted-events:${event.id}`,
        layer: 'permitted-events',
        sourceId: nycPermittedEventsToday.id,
        title: event.name,
        ...NO_PLACE,
        detail: {
          kind: 'permitted-event',
          type: event.type,
          agency: event.agency,
          borough: event.borough,
          location: event.location,
          side: event.side,
          closure: event.closure,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          stretches: event.stretches,
        },
      })),
  }),
]);

const cameras = layerOf('cameras', 'street', [part({ source: ny511Cameras, items: cameraItems })]);

export const streetLayers: readonly CityLayer[] = [
  incidents,
  closures,
  construction,
  streetPermits,
  permittedEvents,
  cameras,
];
