import { CAMERA_IMAGE_HEADERS, cameraImageFailureSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { GENERIC_USER_AGENT } from '../../src/infrastructure/http/client.js';
import {
  imageTypeOf,
  isPublicPictureUrl,
  PICTURE_TTL_MS,
  TIMEOUT_MS,
} from '../../src/modules/city-layers/camera-images.js';
import { ny511Cameras } from '../../src/modules/data-platform/sources/ny511/cameras.js';
import { parsedCapture, readerWith } from '../live-vehicles/reader.js';
import { manualClock } from '../support/manual-clock.js';
import { capturedReader, cityApp, NOW } from './captures.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

interface Asked {
  readonly url: string;
  readonly headers: Headers;
}

/** A camera owner that answers `body` with `headers`, and remembers every request. */
function owner(body: Uint8Array | string, headers: Record<string, string> = {}) {
  const asked: Asked[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    asked.push({ url, headers: new Headers(init?.headers) });
    return Promise.resolve(new Response(body, { status: 200, headers }));
  };
  return { asked, fetch };
}

const LAST_MODIFIED = 'Wed, 11 Nov 2026 05:20:02 GMT';

describe('camera pictures through MovIQ', () => {
  it('asks the picture the list gives, with the generic identity, and dates it by its owner', async () => {
    const camera = owner(JPEG, { 'content-type': 'image/jpeg', 'last-modified': LAST_MODIFIED });
    const app = cityApp(capturedReader(), manualClock(NOW), camera.fetch);
    const response = await app.request('/api/city/cameras/34241/image');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get(CAMERA_IMAGE_HEADERS.time)).toBe('2026-11-11T05:20:02.000Z');
    expect(response.headers.get(CAMERA_IMAGE_HEADERS.basis)).toBe('source');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
    const [request] = camera.asked;
    expect(request?.url).toBe('https://public.carsprogram.org/cameras/NYSDOT/other/8.jpg');
    expect(request?.headers.get('user-agent')).toBe(GENERIC_USER_AGENT);
    expect(request?.headers.get('cookie')).toBeNull();
    expect(request?.headers.get('referer')).toBeNull();
  });

  it('asks each camera once a minute whoever looks, then again', async () => {
    const camera = owner(JPEG, { 'last-modified': LAST_MODIFIED });
    const clock = manualClock(NOW);
    const app = cityApp(capturedReader(), clock, camera.fetch);
    await app.request('/api/city/cameras/34241/image');
    clock.advance(PICTURE_TTL_MS - 1_000);
    const cached = await app.request('/api/city/cameras/34241/image');
    expect(cached.headers.get('cache-control')).toBe('private, max-age=1');
    expect(camera.asked).toHaveLength(1);
    clock.advance(1_000);
    await app.request('/api/city/cameras/34241/image');
    expect(camera.asked).toHaveLength(2);
  });

  it('never takes an address: only ids of the list, and the query is ignored', async () => {
    const camera = owner(JPEG);
    const app = cityApp(capturedReader(), manualClock(NOW), camera.fetch);
    const address = encodeURIComponent('https://example.com/picture.jpg');
    expect((await app.request(`/api/city/cameras/${address}/image`)).status).toBe(404);
    expect((await app.request('/api/city/cameras/99999999/image')).status).toBe(404);
    const withQuery = await app.request(`/api/city/cameras/20930/image?url=${address}`);
    expect(withQuery.status).toBe(200);
    expect(camera.asked.map((request) => request.url)).toEqual([
      'https://nyctmc.org/api/cameras/8a6bc417-4877-4ebe-8052-88c1b261baf1/image',
    ]);
  });

  it('serves a picture by what its bytes are, and refuses what is not a picture', async () => {
    const mislabelled = owner(PNG, { 'content-type': 'image/jpeg' });
    const png = await cityApp(capturedReader(), manualClock(NOW), mislabelled.fetch).request(
      '/api/city/cameras/34327/image',
    );
    expect(png.headers.get('content-type')).toBe('image/png');
    const page = owner('<html>Access denied</html>', { 'content-type': 'image/jpeg' });
    const refused = await cityApp(capturedReader(), manualClock(NOW), page.fetch).request(
      '/api/city/cameras/34327/image',
    );
    expect(refused.status).toBe(503);
    expect(cameraImageFailureSchema.parse(await refused.json()).reason).toBe('camera-down');
  });

  it('refuses a picture larger than a camera still', async () => {
    const huge = owner(JPEG, { 'content-length': String(3 * 1024 * 1024) });
    const response = await cityApp(capturedReader(), manualClock(NOW), huge.fetch).request(
      '/api/city/cameras/34241/image',
    );
    expect(response.status).toBe(503);
  });

  it('says the camera is down when its owner stays silent past the time limit', async () => {
    const silent: typeof globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason as Error);
        });
      });
    const started = Date.now();
    const response = await cityApp(capturedReader(), manualClock(NOW), silent).request(
      '/api/city/cameras/20930/image',
    );
    const waited = Date.now() - started;
    expect(response.status).toBe(503);
    expect(cameraImageFailureSchema.parse(await response.json()).reason).toBe('camera-down');
    expect(waited).toBeGreaterThanOrEqual(TIMEOUT_MS - 100);
    expect(waited).toBeLessThan(TIMEOUT_MS + 2_000);
  }, 10_000);

  it('dates a picture by its receipt when the owner gives no believable time', async () => {
    const ahead = owner(JPEG, { 'last-modified': 'Thu, 12 Nov 2026 05:20:02 GMT' });
    const response = await cityApp(capturedReader(), manualClock(NOW), ahead.fetch).request(
      '/api/city/cameras/34241/image',
    );
    expect(response.headers.get(CAMERA_IMAGE_HEADERS.time)).toBe(NOW);
    expect(response.headers.get(CAMERA_IMAGE_HEADERS.basis)).toBe('received');
  });

  it('says so when the list of cameras is not available', async () => {
    const camera = owner(JPEG);
    const app = cityApp(readerWith(new Map(), NOW), manualClock(NOW), camera.fetch);
    const response = await app.request('/api/city/cameras/34241/image');
    expect(response.status).toBe(503);
    expect(cameraImageFailureSchema.parse(await response.json()).reason).toBe('list-unavailable');
    expect(camera.asked).toEqual([]);
  });

  it('asks at most 120 pictures a minute for every camera together', async () => {
    const list = parsedCapture(ny511Cameras, 'ny511/cameras.json', '2026-11-11T03:50:50Z');
    const [first] = list.cameras;
    if (first === undefined) throw new Error('No camera in the capture');
    const cameras = Array.from({ length: 121 }, (_, index) => ({
      ...first,
      id: String(index + 1),
    }));
    const reader = readerWith(new Map([[ny511Cameras.id, { ...list, cameras }]]), NOW);
    const camera = owner(JPEG);
    const app = cityApp(reader, manualClock(NOW), camera.fetch);
    for (let id = 1; id <= 120; id += 1) await app.request(`/api/city/cameras/${String(id)}/image`);
    const busy = await app.request('/api/city/cameras/121/image');
    expect(busy.status).toBe(503);
    expect(cameraImageFailureSchema.parse(await busy.json()).reason).toBe('busy');
    expect(camera.asked).toHaveLength(120);
  });

  it('knows a picture by its first bytes and asks only public HTTPS addresses', () => {
    expect(imageTypeOf(JPEG)).toBe('image/jpeg');
    expect(imageTypeOf(PNG)).toBe('image/png');
    expect(imageTypeOf(new TextEncoder().encode('GIF89a'))).toBeNull();
    expect(isPublicPictureUrl('https://public.carsprogram.org/cameras/NYSDOT/other/42.jpg')).toBe(
      true,
    );
    for (const address of [
      'http://public.carsprogram.org/a.jpg',
      'https://127.0.0.1/a.jpg',
      'https://localhost/a.jpg',
      'https://[::1]/a.jpg',
      'https://example.com:8443/a.jpg',
      'https://user:pass@example.com/a.jpg',
      'https://camera.internal/a.jpg',
      'not a url',
    ]) {
      expect(isPublicPictureUrl(address), address).toBe(false);
    }
  });
});
