import { toInstant, type CameraImageFailure, type CameraImageTimeBasis } from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import { HttpError, type HttpClient } from '../../infrastructure/http/client.js';
import type { SourceReader } from '../data-platform/reader.js';
import { ny511Cameras, type TrafficCameras } from '../data-platform/sources/ny511/cameras.js';
import { pictureOf } from './layers/street.js';

/** A picture is asked again at most once a minute per camera, whoever looks at it. */
export const PICTURE_TTL_MS = 60_000;
/** A failed picture is not asked again for this long, so a camera down is not hammered. */
const FAILURE_TTL_MS = 15_000;
/** The largest still seen was 160 KB (1280 by 720); larger than this is not a camera still. */
const MAX_BYTES = 2 * 1024 * 1024;
/** Stills answer within a second; an owner silent for 5 s is down, and the card says so soon. */
export const TIMEOUT_MS = 5_000;
/** Pictures kept in memory at once, the least recently asked dropped first. */
const MAX_KEPT = 120;
/** Requests to the owners within a minute, for every camera together. */
const MAX_PER_MINUTE = 120;
/** Clocks may differ a little; a `Last-Modified` further ahead is from a wrong clock. */
const CLOCK_TOLERANCE_MS = 2 * 60_000;

type ImageType = 'image/jpeg' | 'image/png';

type CameraPicture =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly type: ImageType;
      /** The time of the picture, by its owner when `basis` is `source`. */
      readonly time: string;
      readonly basis: CameraImageTimeBasis;
      /** Until when this copy is served without asking the owner again. */
      readonly freshUntil: number;
    }
  | { readonly ok: false; readonly status: 404; readonly message: string }
  | { readonly ok: false; readonly status: 503; readonly failure: CameraImageFailure };

interface CameraImagesDependencies {
  readonly reader: SourceReader;
  readonly clock: Clock;
  /** Sends the generic browser identity, never the project's. */
  readonly http: HttpClient;
}

/** What the bytes are, by their first bytes: the owners' `Content-Type` is sometimes wrong. */
export function imageTypeOf(bytes: Uint8Array): ImageType | null {
  const starts = (signature: readonly number[]) =>
    bytes.length > signature.length && signature.every((byte, index) => bytes[index] === byte);
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  return null;
}

/**
 * Only an address on the public web is asked: HTTPS on its own port, with a host name, never an
 * address of this machine or of a private network, even if the list said so.
 */
export function isPublicPictureUrl(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const literal = /^[\d.]+$/.test(host) || host.startsWith('[');
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    host.includes('.') &&
    !literal &&
    !host.endsWith('.local') &&
    !host.endsWith('.internal')
  );
}

const notFound: CameraPicture = {
  ok: false,
  status: 404,
  message: 'No camera of the list has this id and a picture.',
};

const unavailable = (reason: CameraImageFailure['reason'], message: string): CameraPicture => ({
  ok: false,
  status: 503,
  failure: { reason, message },
});

/** The picture's time from its owner, when it gives a believable one. */
function timeOf(headers: Headers, now: Date): { time: string; basis: CameraImageTimeBasis } {
  const modified = Date.parse(headers.get('last-modified') ?? '');
  if (Number.isFinite(modified) && modified - now.getTime() <= CLOCK_TOLERANCE_MS) {
    return { time: toInstant(new Date(Math.min(modified, now.getTime()))), basis: 'source' };
  }
  return { time: toInstant(now), basis: 'received' };
}

/** The addresses of the pictures of every camera of the list, worked out once per version. */
function pictureIndex(reader: SourceReader) {
  let kept: { readonly version: string; readonly urls: ReadonlyMap<string, string> } | undefined;
  return async (): Promise<ReadonlyMap<string, string> | undefined> => {
    const reading = await reader.read(ny511Cameras);
    const { data, version } = reading;
    if (data === undefined) return undefined;
    if (version === undefined) return urlsOf(data);
    if (kept?.version !== version) kept = { version, urls: urlsOf(data) };
    return kept.urls;
  };
}

function urlsOf(data: TrafficCameras): Map<string, string> {
  return new Map(
    data.cameras.flatMap((camera) => {
      const url = pictureOf(camera);
      return url === null ? [] : [[camera.id, url] as const];
    }),
  );
}

/**
 * The still picture of a 511NY camera, asked by MovIQ's server for the traveller: the browser
 * never talks to the owner, and each camera is asked at most once a minute whoever looks.
 */
export function createCameraImages(deps: CameraImagesDependencies) {
  const index = pictureIndex(deps.reader);
  const kept = new Map<
    string,
    { readonly until: number; readonly value: Promise<CameraPicture> }
  >();
  const asked: number[] = [];

  const fetchPicture = async (url: string): Promise<CameraPicture> => {
    const now = deps.clock.now();
    try {
      const response = await deps.http.get({
        url,
        headers: { accept: 'image/jpeg, image/png' },
        timeoutMs: TIMEOUT_MS,
        maxBytes: MAX_BYTES,
      });
      const type = imageTypeOf(response.body);
      if (type === null) return unavailable('camera-down', 'The camera sent no picture.');
      return {
        ok: true,
        bytes: response.body,
        type,
        ...timeOf(response.headers, now),
        freshUntil: now.getTime() + PICTURE_TTL_MS,
      };
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      return unavailable('camera-down', 'The camera did not send its picture.');
    }
  };

  const keep = (id: string, value: Promise<CameraPicture>, at: number) => {
    kept.set(id, { until: at + PICTURE_TTL_MS, value });
    void value.then((picture) => {
      const entry = kept.get(id);
      if (!picture.ok && entry?.value === value)
        kept.set(id, { until: at + FAILURE_TTL_MS, value });
    });
    for (const oldest of kept.keys()) {
      if (kept.size <= MAX_KEPT) break;
      kept.delete(oldest);
    }
  };

  /** True when one more request to the owners fits in the minute. */
  const withinRate = (at: number) => {
    while (asked.length > 0 && (asked[0] ?? at) <= at - 60_000) asked.shift();
    if (asked.length >= MAX_PER_MINUTE) return false;
    asked.push(at);
    return true;
  };

  return {
    async picture(id: string): Promise<CameraPicture> {
      const at = deps.clock.now().getTime();
      const entry = kept.get(id);
      if (entry !== undefined && at < entry.until) {
        kept.delete(id);
        kept.set(id, entry);
        return entry.value;
      }
      const urls = await index();
      if (urls === undefined) {
        return unavailable('list-unavailable', 'The list of cameras is not available.');
      }
      const url = urls.get(id);
      if (url === undefined || !isPublicPictureUrl(url)) return notFound;
      if (!withinRate(at))
        return unavailable('busy', 'Too many pictures asked; try again shortly.');
      const value = fetchPicture(url);
      keep(id, value, at);
      return value;
    },
  };
}
