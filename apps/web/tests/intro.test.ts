import { describe, expect, it } from 'vitest';

import { claimIntro, type IntroEnvironment } from '../src/features/home/intro/once';
import { INTRO_MS, introTimeline } from '../src/features/home/intro/timeline';

function sessionStore(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const env = (overrides: Partial<IntroEnvironment> = {}): IntroEnvironment => ({
  storage: sessionStore(),
  reducedMotion: false,
  ...overrides,
});

describe('the intro', () => {
  it('plays once per session, when MovIQ opens at its home page', () => {
    const visit = env();
    expect(claimIntro(visit, true)).toBe(true);
    expect(claimIntro(visit, true)).toBe(false);
  });

  it('does not play when the session opened elsewhere, not even on reaching home later', () => {
    const visit = env();
    expect(claimIntro(visit, false)).toBe(false);
    expect(claimIntro(visit, true)).toBe(false);
  });

  it('never plays with reduced motion, nor without storage to play it only once', () => {
    expect(claimIntro(env({ reducedMotion: true }), true)).toBe(false);
    expect(claimIntro(env({ storage: null }), true)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    };
    expect(claimIntro(env({ storage: broken }), true)).toBe(false);
  });

  it('types the line, blinks the cursor three times, then lets the photo rise', () => {
    const beats = introTimeline('Move smarter.'.length);
    expect(beats.step).toBe(95);
    expect(beats.typed).toBe(INTRO_MS.typeStart + 95 * 13);
    // Three blinks of 0.8 s, the length of `intro-blink` times its count in intro.css.
    expect(beats.reveal - beats.typed).toBe(3 * 800);
    expect(beats.leave - beats.reveal).toBe(INTRO_MS.reveal + INTRO_MS.hold);
    expect(beats.done - beats.leave).toBe(INTRO_MS.leave);
  });

  it('types at a steady pace whatever the length of the line', () => {
    expect(introTimeline(100).step).toBe(40);
    expect(introTimeline(0).step).toBe(95);
  });
});
