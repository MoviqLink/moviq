import { journeySchema, type Journey } from '@moviq/contracts';

import { api, type ApiClient } from '../../../shared/api/client';
import { ApiRequestError } from '../../../shared/api/errors';

/** One saved trip as the screen shows it: still asked for, read, or not readable now. */
export type TripView =
  | { readonly id: string; readonly state: 'loading' }
  | { readonly id: string; readonly state: 'ready'; readonly journey: Journey }
  | { readonly id: string; readonly state: 'failed' };

/** What came back for one trip: the trip, a trip the server does not know, or a failure. */
export type TripAnswer =
  | { readonly kind: 'ready'; readonly journey: Journey }
  | { readonly kind: 'gone' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'cancelled' };

/** Reads an error: a 404 means the trip is not this traveller's any more; others are failures. */
export function answerOfError(error: unknown): TripAnswer {
  if (!(error instanceof ApiRequestError)) throw error;
  const { failure } = error;
  if (failure.kind === 'aborted') return { kind: 'cancelled' };
  if (failure.kind === 'http' && failure.status === 404) return { kind: 'gone' };
  return { kind: 'failed' };
}

/** `GET /api/journeys/:id`, validated against the contract: the server answers only its owner. */
export async function loadTrip(
  id: string,
  signal: AbortSignal,
  client: ApiClient = api,
): Promise<TripAnswer> {
  try {
    const journey = await client.json(`/api/journeys/${encodeURIComponent(id)}`, journeySchema, {
      signal,
    });
    return { kind: 'ready', journey };
  } catch (error) {
    return answerOfError(error);
  }
}
