import type { Itinerary } from '@moviq/contracts';

export type Accessibility = NonNullable<Itinerary['accessibility']>;
export type PlatformAccess = Accessibility['platforms'][number];
export type AccessWarning = Accessibility['warnings'][number];

/**
 * The one sentence of a step-free trip: checked and clear, broken at a station, not confirmed
 * there, not checkable now (the MTA lists are down), or never checked (planned before it existed).
 */
export type StepFreeLead =
  | { readonly kind: 'not-checked' }
  | { readonly kind: 'unchecked' }
  | { readonly kind: 'clear'; readonly checkedAt: string }
  | { readonly kind: 'elevator-out'; readonly station: string; readonly elevator: string | null }
  | { readonly kind: 'not-step-free'; readonly station: string }
  | { readonly kind: 'unconfirmed'; readonly station: string }
  | { readonly kind: 'walk-unchecked'; readonly step: number };

/**
 * The worst platform decides: an elevator out, then no step-free access, then not confirmed;
 * then a walk not checked with a wheelchair.
 */
export function stepFreeLead(access: Accessibility | null | undefined): StepFreeLead {
  if (access === null || access === undefined) return { kind: 'not-checked' };
  const { platforms, checkedAt } = access;
  if (checkedAt === null || platforms.some((p) => p.cause === 'lists-unavailable')) {
    return { kind: 'unchecked' };
  }
  const out = platforms.find((p) => p.state === 'elevator-out');
  if (out !== undefined) {
    return { kind: 'elevator-out', station: out.station, elevator: out.elevators[0]?.id ?? null };
  }
  const none = platforms.find((p) => p.state === 'not-step-free');
  if (none !== undefined) return { kind: 'not-step-free', station: none.station };
  const unknown = platforms.find((p) => p.state === 'unknown');
  if (unknown !== undefined) return { kind: 'unconfirmed', station: unknown.station };
  // A walk not walked with a wheelchair keeps the trip from being called step-free.
  const walk = access.warnings.find((warning) => warning.kind === 'walk-unverified');
  if (walk !== undefined) return { kind: 'walk-unchecked', step: walk.legIndex + 1 };
  return { kind: 'clear', checkedAt };
}

/** A platform's state that keeps the step-free route, as the rail colours it. */
export const isOpen = (platform: PlatformAccess): boolean =>
  platform.state === 'accessible' || platform.state === 'one-direction';
