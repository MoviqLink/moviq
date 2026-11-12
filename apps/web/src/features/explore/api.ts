import {
  liveInterestResponseSchema,
  liveVehiclesResponseSchema,
  type BoundingBox,
  type LiveInterestResponse,
  type LiveMode,
  type LiveLineKey,
  type LiveVehiclesResponse,
} from '@moviq/contracts';

import { api } from '../../shared/api/client';

const round = (value: number) => value.toFixed(4);

/**
 * Every vehicle and station of the modes shown inside the box, with the state of each mode and
 * source; the counts are those of the whole city.
 */
export function fetchLive(
  box: BoundingBox,
  modes: readonly LiveMode[],
  signal: AbortSignal,
  lines?: readonly LiveLineKey[],
): Promise<LiveVehiclesResponse> {
  const query = new URLSearchParams({ bbox: box.map(round).join(','), modes: modes.join(',') });
  if (lines !== undefined) query.set('lines', JSON.stringify(lines));
  return api.json(`/api/live/vehicles?${query.toString()}`, liveVehiclesResponseSchema, { signal });
}

/** Tells the platform that someone is looking at these modes, so it reads them quickly. */
export function registerInterest(
  modes: readonly LiveMode[],
  signal: AbortSignal,
): Promise<LiveInterestResponse> {
  return api.json('/api/live/interest', liveInterestResponseSchema, {
    method: 'POST',
    body: { modes },
    signal,
  });
}
