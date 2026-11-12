import { setTimeout as delay } from 'node:timers/promises';

/** Waits `ms`, or less if `signal` aborts first. Never rejects, so loops can simply re-check. */
export async function pause(ms: number, signal: AbortSignal): Promise<void> {
  await delay(ms, undefined, { signal }).catch(() => undefined);
}
