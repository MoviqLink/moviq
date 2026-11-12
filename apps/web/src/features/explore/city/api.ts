import {
  CAMERA_IMAGE_HEADERS,
  cameraImageFailureSchema,
  cameraImageTimeBasisSchema,
  cityLayersResponseSchema,
  instantSchema,
  parkingSignsResponseSchema,
  type BoundingBox,
  type CameraImageFailure,
  type CameraImageTimeBasis,
  type CityLayerId,
  type CityLayersResponse,
  type ParkingSignsResponse,
} from '@moviq/contracts';

import { api } from '../../../shared/api/client';

const round = (value: number) => value.toFixed(4);

/** Every city layer counted, and the items of the layers asked inside the box. */
export function fetchCityLayers(
  box: BoundingBox,
  layers: readonly CityLayerId[],
  signal: AbortSignal,
): Promise<CityLayersResponse> {
  const query = `bbox=${box.map(round).join(',')}&layers=${layers.join(',')}`;
  return api.json(`/api/city/layers?${query}`, cityLayersResponseSchema, { signal });
}

/** The parking signs of the tile around a point, with their text as DOT lists it. */
export function fetchParkingSigns(
  point: readonly [number, number],
  signal: AbortSignal,
): Promise<ParkingSignsResponse> {
  const [lon, lat] = point;
  const query = `lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`;
  return api.json(`/api/city/parking-signs?${query}`, parkingSignsResponseSchema, { signal });
}

export type CameraPicture =
  | {
      readonly ok: true;
      readonly blob: Blob;
      readonly time: string;
      readonly basis: CameraImageTimeBasis;
    }
  | { readonly ok: false; readonly reason: CameraImageFailure['reason'] | 'not-found' | 'network' };

/**
 * A camera's still picture, asked of MovIQ's own server: the browser never asks the camera's
 * owner. The time comes with it, by the owner or by the moment MovIQ received it.
 */
export async function fetchCameraPicture(id: string, signal: AbortSignal): Promise<CameraPicture> {
  let response: Response;
  try {
    response = await fetch(`/api/city/cameras/${encodeURIComponent(id)}/image`, { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    return { ok: false, reason: 'network' };
  }
  if (response.status === 404) return { ok: false, reason: 'not-found' };
  if (!response.ok) {
    const failure = cameraImageFailureSchema.safeParse(await response.json().catch(() => null));
    return { ok: false, reason: failure.success ? failure.data.reason : 'camera-down' };
  }
  const time = instantSchema.safeParse(response.headers.get(CAMERA_IMAGE_HEADERS.time));
  const basis = cameraImageTimeBasisSchema.safeParse(
    response.headers.get(CAMERA_IMAGE_HEADERS.basis),
  );
  const type = response.headers.get('content-type') ?? '';
  if (!time.success || !basis.success || !/^image\/(jpeg|png)$/.test(type)) {
    return { ok: false, reason: 'camera-down' };
  }
  return { ok: true, blob: await response.blob(), time: time.data, basis: basis.data };
}
