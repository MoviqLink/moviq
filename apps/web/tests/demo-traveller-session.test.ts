import { afterEach, describe, expect, it, vi } from 'vitest';
import { setTravellerEntered, travellerEntered } from '../src/features/demo/travellerSession';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('traveller navigation preference', () => {
  it('persists in the tab and clears when the profile changes', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    });
    expect(travellerEntered()).toBe(false);
    setTravellerEntered(true);
    expect(travellerEntered()).toBe(true);
    setTravellerEntered(false);
    expect(travellerEntered()).toBe(false);
  });

  it('works for the current page if storage is blocked', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    setTravellerEntered(true);
    expect(travellerEntered()).toBe(true);
    setTravellerEntered(false);
    expect(travellerEntered()).toBe(false);
  });
});
