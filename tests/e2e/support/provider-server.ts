import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';

import { DAY, isUtcDateTime, shiftFor, shiftJsonTimes } from './clock-shift.js';
import { gtfsRealtimeTime, shiftGtfsRealtime, type TrainDelay } from './gtfs-shift.js';
import { CONTROL_PATH, readTrainDelay } from './provider-control.js';
import { relay } from './relay.js';
import { daysSince, shiftTimetable } from './timetable-shift.js';

/** How the times of a capture move to the test's clock. */
type CaptureTimes =
  /** Every time in the feed, moved so that its header time falls on the anchor. */
  | { readonly format: 'gtfs-realtime' }
  /** Every UTC date-time string, moved so that `capturedAt` falls on the anchor. */
  | { readonly format: 'json'; readonly capturedAt: string }
  /**
   * Every date of a static GTFS timetable, moved by whole days so that `serviceDay` (`20261110`),
   * the day its trips were kept for, is the New York date the timetable is asked on.
   */
  | { readonly format: 'gtfs-static'; readonly serviceDay: string };

export interface Capture {
  /** Relative to `tests/fixtures/`. */
  readonly file: string;
  /** Absent for captures whose times nothing compares with the clock. */
  readonly times?: CaptureTimes;
  /**
   * Only requests with these query values get this capture. Date-times are compared as they
   * were asked when the capture was taken, so a request shifted like its answer still matches.
   */
  readonly query?: Readonly<Record<string, string>>;
}

/** Maps the host and path a source requests to the captures that may answer it, in order. */
export type CaptureRoutes = Readonly<Record<string, readonly Capture[]>>;

interface ProviderServer {
  readonly origin: string;
  readonly close: () => Promise<void>;
}

interface ClockState {
  anchorMs: number;
  delays: { readonly path: string; readonly delay: TrainDelay }[];
}

/**
 * Stands in for every provider during end-to-end runs: the API's HTTP client sends requests here
 * (`TEST_PROVIDER_ORIGIN`) with the original host as the first path segment, and each one gets
 * the capture of a real response listed in `routes` for that path and query, its times moved to
 * the test's clock. Anything not listed is a 404. Requests for `relayHosts` are not answered
 * here but sent on to the real host (`relay.ts`). `CONTROL_PATH` lets the tests move the anchor
 * and make a train late.
 */
export async function startProviderServer(
  fixtures: string,
  routes: CaptureRoutes,
  relayHosts: readonly string[] = [],
): Promise<ProviderServer> {
  const clock: ClockState = { anchorMs: Date.now(), delays: [] };
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://provider.test');
    const path = url.pathname.slice(1);
    const host = path.split('/', 1)[0] ?? '';
    const handled = path.startsWith(CONTROL_PATH)
      ? control(path.slice(CONTROL_PATH.length), request, clock)
      : relayHosts.includes(host)
        ? relay(request, new URL(`https://${path}${url.search}`))
        : answer(fixtures, routes, clock, path, url.searchParams);
    handled.then(
      ({ status, headers, body }) => {
        response
          .writeHead(status, { ...headers, 'content-length': String(body.byteLength) })
          .end(body);
      },
      (error: unknown) => {
        failed(response, error);
      },
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No local port.');
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

interface Reply {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

const EMPTY = new Uint8Array();
const json = (value: unknown): Reply => ({
  status: 200,
  body: new TextEncoder().encode(JSON.stringify(value)),
});

function failed(response: ServerResponse, error: unknown): void {
  const text = error instanceof Error ? error.message : String(error);
  response.writeHead(500, { 'content-type': 'text/plain' }).end(text);
}

async function answer(
  fixtures: string,
  routes: CaptureRoutes,
  clock: ClockState,
  path: string,
  query: URLSearchParams,
): Promise<Reply> {
  for (const capture of routes[path] ?? []) {
    const body = await readFile(join(fixtures, capture.file));
    const shiftMs = shiftOf(capture, body, clock.anchorMs);
    if (!matches(capture.query, query, shiftMs)) continue;
    const delays = clock.delays.filter((entry) => entry.path === path).map(({ delay }) => delay);
    return { status: 200, body: shifted(capture, body, shiftMs, delays) };
  }
  return { status: 404, body: EMPTY };
}

function shiftOf(capture: Capture, body: Uint8Array, anchorMs: number): number {
  const times = capture.times;
  switch (times?.format) {
    case undefined:
      return 0;
    case 'gtfs-realtime':
      return shiftFor(anchorMs, gtfsRealtimeTime(body));
    case 'json':
      return shiftFor(anchorMs, Date.parse(times.capturedAt));
    // Whole days from the clock, not the anchor: the server checks a timetable against its date.
    case 'gtfs-static':
      return daysSince(times.serviceDay, Date.now()) * DAY;
  }
}

function matches(expected: Capture['query'], query: URLSearchParams, shiftMs: number): boolean {
  if (expected === undefined) return true;
  return Object.entries(expected).every(([name, value]) => {
    const asked = query.get(name);
    if (asked === null) return false;
    if (!isUtcDateTime(value)) return asked === value;
    return Date.parse(asked) === Date.parse(value) + shiftMs;
  });
}

function shifted(
  capture: Capture,
  body: Uint8Array,
  shiftMs: number,
  delays: readonly TrainDelay[],
): Uint8Array {
  switch (capture.times?.format) {
    case undefined:
      return body;
    case 'gtfs-realtime':
      return shiftGtfsRealtime(body, shiftMs, delays);
    case 'gtfs-static':
      return shiftTimetable(body, Math.round(shiftMs / DAY));
    case 'json': {
      const value: unknown = JSON.parse(new TextDecoder().decode(body));
      return new TextEncoder().encode(JSON.stringify(shiftJsonTimes(value, shiftMs)));
    }
  }
}

/** `POST anchor`: the test's "now" is now, with no late trains. `POST delay`: a late train. */
async function control(
  action: string,
  request: IncomingMessage,
  clock: ClockState,
): Promise<Reply> {
  if (request.method !== 'POST') return { status: 405, body: EMPTY };
  if (action === 'anchor') {
    clock.anchorMs = Date.now();
    clock.delays = [];
    return json({ anchor: new Date(clock.anchorMs).toISOString() });
  }
  if (action === 'delay') {
    const read = readTrainDelay(await bodyOf(request));
    if (read === undefined) return { status: 400, body: EMPTY };
    clock.delays.push(read);
    return json({ delays: clock.delays.length });
  }
  return { status: 404, body: EMPTY };
}

async function bodyOf(request: IncomingMessage): Promise<unknown> {
  try {
    const parsed: unknown = JSON.parse(await text(request));
    return parsed;
  } catch {
    return undefined;
  }
}
