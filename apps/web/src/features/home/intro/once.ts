const SEEN_KEY = 'moviq-intro-seen';

/** What decides whether the intro plays: the visit's storage and the motion the person allows. */
export interface IntroEnvironment {
  /** The session's storage; null when the browser blocks it. */
  readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  readonly reducedMotion: boolean;
}

/**
 * Whether the intro plays now, and the visit counts as opened from here on. It plays once per
 * browser session, only when MovIQ opens at its home page and only if the person allows motion.
 * Without storage it never plays, since nothing could stop it from playing on every load.
 */
export function claimIntro(env: IntroEnvironment, atHome: boolean): boolean {
  if (env.storage === null) return false;
  try {
    if (env.storage.getItem(SEEN_KEY) === '1') return false;
    env.storage.setItem(SEEN_KEY, '1');
  } catch {
    return false;
  }
  return atHome && !env.reducedMotion;
}

function browserEnvironment(): IntroEnvironment {
  let storage: Storage | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    // Storage blocked: the intro never plays.
  }
  return {
    storage,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

let pending: boolean | null = null;

/** Takes the decision at the first address MovIQ opens on this load; later calls change nothing. */
export function openMovIq(atHome: boolean): void {
  pending ??= claimIntro(browserEnvironment(), atHome);
}

/** True while the intro decided for this load has not played yet. */
export const introPending = (): boolean => pending === true;

/** The intro played or was skipped: going back home later does not play it again. */
export function introPlayed(): void {
  pending = false;
}
