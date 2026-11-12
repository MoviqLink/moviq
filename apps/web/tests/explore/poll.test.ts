import { afterEach, describe, expect, it, vi } from 'vitest';

import { startPolling } from '../../src/features/explore/live/poll';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('live city polling', () => {
  it('stops the old view after a change and ignores a late response, then stops on unmount', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    let finishOld: (() => void) | undefined;
    const shown: string[] = [];
    const oldRead = vi.fn(async (signal: AbortSignal) => {
      await new Promise<void>((resolve) => {
        finishOld = resolve;
      });
      if (!signal.aborted) shown.push('old');
    });
    const stopOld = startPolling(oldRead, 15_000);
    stopOld();
    const newRead = vi.fn((signal: AbortSignal) => {
      if (!signal.aborted) shown.push('new');
      return Promise.resolve();
    });
    const stopNew = startPolling(newRead, 15_000);
    finishOld?.();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(shown).toEqual(['new', 'new']);
    expect(oldRead).toHaveBeenCalledTimes(1);
    expect(newRead).toHaveBeenCalledTimes(2);
    stopNew();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(newRead).toHaveBeenCalledTimes(2);
  });
  it('pauses and aborts when hidden, then resumes without overlapping', async () => {
    vi.useFakeTimers();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('document', doc);
    const pending: { signal: AbortSignal; finish: () => void }[] = [];
    const read = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((finish) => {
          pending.push({ signal, finish });
        }),
    );
    const stop = startPolling(read, 30_000);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(pending[0]?.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(read).toHaveBeenCalledTimes(1);
    pending[0]?.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
  });
});
