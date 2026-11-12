import {
  needViewSchema,
  virtualCurrentSchema,
  virtualEstimateResponseSchema,
  virtualJourneyResponseSchema,
  virtualMetricsSchema,
  virtualPlacesSchema,
  virtualRideSchema,
  type Place,
  type Taste,
} from '@moviq/contracts';
import { api, MODEL_TIMEOUT_MS } from '../../shared/api/client';
import type { Lang } from '../../shared/i18n/lang';
const base = '/api/virtual';
const ridePath = (id: string) => `${base}/rides/${encodeURIComponent(id)}`;
export const virtualApi = {
  current: (signal: AbortSignal) =>
    api.json(`${base}/rides/current`, virtualCurrentSchema, { signal }),
  board: (vehicleId: string) =>
    api.json(`${base}/rides`, virtualRideSchema, { method: 'POST', body: { vehicleId } }),
  getOff: (id: string) => api.send(ridePath(id), { method: 'DELETE' }),
  need: (id: string, body: { invitationId: string; alias: string; taste: Taste; language: Lang }) =>
    api.json(`${ridePath(id)}/needs`, needViewSchema, {
      method: 'POST',
      body,
      timeoutMs: MODEL_TIMEOUT_MS,
    }),
  places: (query: string, signal: AbortSignal) =>
    api.json(`${base}/places?q=${encodeURIComponent(query)}`, virtualPlacesSchema, { signal }),
  estimate: (id: string, offerId: string, origin: Place, signal: AbortSignal) =>
    api.json(`${ridePath(id)}/estimate`, virtualEstimateResponseSchema, {
      method: 'POST',
      body: { offerId, origin },
      signal,
      timeoutMs: MODEL_TIMEOUT_MS,
    }),
  journey: (id: string, offerId: string) =>
    api.json(`${ridePath(id)}/journey`, virtualJourneyResponseSchema, {
      method: 'POST',
      body: { offerId },
      timeoutMs: MODEL_TIMEOUT_MS,
    }),
  metrics: (signal: AbortSignal) =>
    api.json(`${base}/partner/metrics`, virtualMetricsSchema, { signal }),
};
