import { afterEach, describe, expect, it } from 'vitest';

import { createSourceReader } from '../../../src/modules/data-platform/reader.js';
import { subwaySources } from '../../../src/modules/data-platform/sources/mta/subway-realtime.js';
import { createPositionEstimator } from '../../../src/modules/live/estimation/estimator.js';
import type { ExtractedEvent } from '../../../src/modules/recorder/events.js';
import { recorderExtractors } from '../../../src/modules/recorder/extractors/index.js';
import { liveCity, type LiveCity } from '../city.js';
import { subwayLater, TRAIN_A } from '../feeds.js';

const [aceFeed] = subwaySources;

interface Asked {
  readonly runTime: [string, string, string][];
  readonly forHorizon: string[];
  readonly typicalSpeed: [string, string][];
  readonly forAge: [string, string][];
}

/** A recorder that measured nothing and notes every question the estimator asks it. */
function listening(asked: Asked) {
  return createPositionEstimator({
    segments: {
      runTime: (route, from, to) => (asked.runTime.push([route, from, to]), null),
      typicalSpeed: (route, line) => (asked.typicalSpeed.push([route, line.id]), null),
    },
    predictions: { forHorizon: (route) => (asked.forHorizon.push(route), null) },
    tracking: { forAge: (mode, route) => (asked.forAge.push([mode, route]), null) },
  });
}

let city: LiveCity | undefined;

afterEach(async () => {
  await city?.dispose();
  city = undefined;
});

/** What the recorder's own extractor of the A, C and E feed writes for the version stored now. */
async function recorded(open: LiveCity, session: ReturnType<typeof startAce>) {
  if (!aceFeed) throw new Error('no A, C and E feed');
  const reading = await createSourceReader({
    db: open.db,
    clock: open.clock,
    missingVariables: () => [],
  }).read(aceFeed);
  const result = session.extract(reading.data, {
    version: reading.version ?? '',
    dataTime: new Date(reading.provenance.dataTime ?? 0),
    previousDataTime: undefined,
  });
  if (!result.ok) throw new Error(result.why);
  return result.events;
}

function startAce() {
  const extractor = recorderExtractors.find((candidate) => candidate.sourceId === aceFeed?.id);
  if (extractor === undefined) throw new Error('the A, C and E feed is not recorded');
  return extractor.start(new Map());
}

const ofTrain = (events: readonly ExtractedEvent[]) =>
  events.filter((event) => 'trip' in event && event.trip === TRAIN_A);

describe('the keys the estimator asks with and the keys the recorder writes', () => {
  it('asks for a subway segment by the route and stop ids the recorder times it with', async () => {
    const asked: Asked = { runTime: [], forHorizon: [], typicalSpeed: [], forAge: [] };
    city = await liveCity(listening(asked));
    const session = startAce();
    await city.collect();
    await city.app.request('/api/live/vehicles');
    const first = ofTrain(await recorded(city, session));
    city.clock.advance(60_000);
    if (!aceFeed) throw new Error('no A, C and E feed');
    await city.collect([aceFeed], new Map([[aceFeed.id, subwayLater(60, 180)]]));
    await city.app.request('/api/live/vehicles');
    const later = ofTrain(await recorded(city, session));

    // The estimator, between 181 St and 190 St on the A, asks for A06N → A05N on route `A`.
    expect(asked.runTime).toContainEqual(['A', 'A06N', 'A05N']);
    expect(asked.forHorizon).toContain('A');
    // The recorder times that segment from its arrival at A06N, naming A05N as the next stop,
    // and sees the departure from A06N towards A05N: the same route and stop ids.
    expect(first).toContainEqual(
      expect.objectContaining({ k: 'stn', ev: 'arr', route: 'A', stop: 'A06N', next: 'A05N' }),
    );
    expect(later).toContainEqual(
      expect.objectContaining({ k: 'stn', ev: 'dep', route: 'A', stop: 'A06N', next: 'A05N' }),
    );
    // Its predictions are kept by feed: the adapter maps route `A` to `mta-subway-ace`.
    expect(first.some((event) => event.k === 'pred')).toBe(true);
  });

  it('records no shape, no metres and no other network for what the buses ask', async () => {
    const asked: Asked = { runTime: [], forHorizon: [], typicalSpeed: [], forAge: [] };
    city = await liveCity(listening(asked));
    await city.collect();
    await city.app.request('/api/live/vehicles');
    city.clock.advance(120_000);
    await city.app.request('/api/live/vehicles');
    // Buses on their shapes ask for a speed by route and shape, and for a margin by route.
    expect(asked.typicalSpeed.length).toBeGreaterThan(0);
    expect(asked.forAge.every(([mode]) => mode === 'bus')).toBe(true);
    expect(asked.forAge.length).toBeGreaterThan(0);
    // The recorder keeps buses by route and stops only, and records two kinds of trip; neither
    // the LIRR (`lirr:1`) nor NYC Ferry (`nyc-ferry:ER`) is recorded, so both stay unanswered.
    const modes = new Set(recorderExtractors.map((extractor) => extractor.mode));
    expect([...modes].filter((mode) => mode !== null).sort()).toEqual(['bus', 'subway']);
  });
});
