import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRoutePolling } from '../../src/features/explore/map/route-poller';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('selected route refresh', () => {
  it('waits 30 seconds after each response, does not overlap and aborts on disposal', async () => {
    vi.useFakeTimers();
    const doc = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const pending: { signal: AbortSignal; resolve: () => void }[] = [];
    const read = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          pending.push({ signal, resolve });
        }),
    );
    const stop = startRoutePolling(read);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
    pending[0]?.resolve();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
    expect(pending[1]?.signal.aborted).toBe(true);
    pending[1]?.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('aborts when hidden and refreshes on return without overlapping the previous request', async () => {
    vi.useFakeTimers();
    const doc = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const pending: { signal: AbortSignal; resolve: () => void }[] = [];
    const read = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          pending.push({ signal, resolve });
        }),
    );
    const stop = startRoutePolling(read);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(pending[0]?.signal.aborted).toBe(true);
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(read).toHaveBeenCalledTimes(1);
    pending[0]?.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
  });
});
