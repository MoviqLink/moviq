import { shiftFor } from './clock-shift.js';
import type { TrainDelay } from './gtfs-shift.js';

/** Requests under this path go to the stand-in itself, never to a provider capture. */
export const CONTROL_PATH = '__control/';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A late train as a test sends it, with the feed path it applies to; undefined if malformed. */
export function readTrainDelay(
  value: unknown,
): { readonly path: string; readonly delay: TrainDelay } | undefined {
  if (!isRecord(value)) return undefined;
  const { path, routeId, stopId, plannedAt, minutes } = value;
  if (typeof path !== 'string' || typeof routeId !== 'string' || typeof stopId !== 'string')
    return undefined;
  if (typeof plannedAt !== 'string' || Number.isNaN(Date.parse(plannedAt))) return undefined;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 90)
    return undefined;
  return { path, delay: { routeId, stopId, plannedAt, minutes } };
}

function origin(): string {
  const url = process.env['E2E_PROVIDER_ORIGIN'];
  if (url === undefined) throw new Error('E2E_PROVIDER_ORIGIN is set by the global setup.');
  return url;
}

async function post(action: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${origin()}/${CONTROL_PATH}${action}`, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`The provider stand-in refused ${action}.`);
  const answer: unknown = await response.json();
  return answer;
}

/** The test clock, with shifted captures falling on the moment it was set. */
export interface TestClock {
  /** Where an instant written in a capture taken at `capturedAt` falls in this run. */
  readonly shifted: (capturedAt: string, instant: string) => Date;
}

/** Sets the test's "now" to this moment and clears late trains: captures replay from here. */
export async function resetProviderClock(): Promise<TestClock> {
  const answer = await post('anchor');
  const anchor = isRecord(answer) ? answer['anchor'] : undefined;
  if (typeof anchor !== 'string') throw new Error('The stand-in gave no anchor.');
  const anchorMs = Date.parse(anchor);
  return {
    shifted: (capturedAt, instant) =>
      new Date(Date.parse(instant) + shiftFor(anchorMs, Date.parse(capturedAt))),
  };
}

/** Makes the followed train of a leg, and those after it, run late in one live feed. */
export async function delayTrain(path: string, delay: TrainDelay): Promise<void> {
  await post('delay', { path, ...delay });
}
