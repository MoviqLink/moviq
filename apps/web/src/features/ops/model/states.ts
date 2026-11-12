import type { SourceRow, SourceState } from '@moviq/contracts';

import type { IconName } from '../../../shared/ui/Icon';
import { ageBand, type AgeBand } from './age';

/** Each state's own icon; its colour is the `--st-<state>` token and its words are in i18n. */
export const STATE_ICON: Record<SourceState, IconName> = {
  healthy: 'check',
  degraded: 'degraded',
  stale: 'clock',
  unavailable: 'cross',
  rate_limited: 'gauge',
  misconfigured: 'wrench',
  outside_service: 'moon',
  unknown: 'question',
};

/** The state whose colour an age band borrows. */
const BAND_STATE: Record<AgeBand, SourceState> = {
  fresh: 'healthy',
  degraded: 'degraded',
  stale: 'stale',
  unavailable: 'unavailable',
};

/**
 * The state whose colour the age of a source takes. Outside its service period old data is
 * expected, so its age is drawn neutral rather than as a failure.
 */
export function ageLook(
  state: SourceState,
  ageSeconds: number,
  freshness: SourceRow['freshness'],
): SourceState {
  return state === 'outside_service' ? state : BAND_STATE[ageBand(ageSeconds, freshness)];
}
