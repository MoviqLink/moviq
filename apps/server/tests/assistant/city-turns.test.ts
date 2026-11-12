import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/database.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import type { TempDatabase } from '../support/temp-database.js';
import {
  CITY_NOW,
  fakeCity,
  liveSource,
  m15Bus,
  modeSummary,
  subwayTrain,
  type Served,
} from './city-doubles.js';
import {
  aceFeedData,
  ferryAlertsData,
  mtaAlertsData,
  pathAlertsData,
  recorderStatsData,
} from './city-data.js';
import { assistantDatabase } from './doubles.js';
import { device, harness as build, type HarnessOptions } from './harness.js';

let temp: TempDatabase;
let db: Database;
let clock: ManualClock;

beforeEach(async () => {
  clock = manualClock(CITY_NOW);
  ({ temp, db } = await assistantDatabase(clock));
});

afterEach(async () => {
  await temp.dispose();
});

const harness = (options: Partial<HarnessOptions> = {}) => build({ db, clock, ...options });

const CITY = fakeCity({
  modes: [
    modeSummary('subway', 'live', ['mta-subway-ace']),
    modeSummary('bus', 'live', ['mta-bus-positions', 'mta-bus-trip-updates']),
  ],
  vehicles: [subwayTrain(), subwayTrain({ id: 'subway:A-3' }), m15Bus()],
  sources: [
    liveSource('mta-subway-ace', 'MTA subway live: A C E and Rockaway shuttle'),
    liveSource('mta-bus-positions', 'MTA Bus Time positions'),
    liveSource('mta-bus-trip-updates', 'MTA Bus Time predictions'),
  ],
});

const SERVED: Readonly<Record<string, Served>> = {
  'mta-alerts': { data: mtaAlertsData() },
  'mta-subway-ace': { data: aceFeedData() },
};

describe('Sara answers about lines in basic mode', () => {
  it('"¿cómo va la línea A?": alerts in force, trains followed, cancelled trips and sources', async () => {
    const { app, planner } = harness({ served: SERVED, city: CITY });
    const turn = await device(app).say('¿Cómo va la línea A?', 'es');
    expect(turn.mode).toBe('basic');
    expect(turn.reply).toContain('Hay 1 aviso en vigor en la A; se publican en inglés.');
    expect(turn.reply).toContain('A C trains are running with delays in both directions.');
    expect(turn.reply).toContain('Trenes de la A en seguimiento en directo: 2.');
    expect(turn.reply).not.toContain('skip 59 St');
    const [card] = turn.city;
    expect(card).toMatchObject({ kind: 'line-status', subject: 'A', level: 'notice' });
    expect(card?.items.map((item) => item.text)).toContain('La MTA da 1 viaje como cancelado.');
    expect(card?.sources.map((source) => source.sourceId)).toEqual([
      'mta-alerts',
      'mta-subway-ace',
    ]);
    expect(card?.sources[0]).toMatchObject({
      state: 'healthy',
      dataTime: '2026-11-11T11:59:00.000Z',
    });
    expect(turn.draft).toEqual({ origin: null, destination: null, arriveBy: null, flight: null });
    expect(planner.requests).toHaveLength(0);
  });

  it('says it cannot check when the alerts are down, never that there are none', async () => {
    const { app } = harness({ served: { 'mta-subway-ace': { data: aceFeedData() } }, city: CITY });
    const turn = await device(app).say('How is the A doing?');
    expect(turn.reply).toContain("I can't check the alerts of the A right now.");
    expect(turn.reply).not.toMatch(/no alerts|no incidents/i);
    expect(turn.city[0]).toMatchObject({ level: 'unknown' });
    expect(turn.city[0]?.sources[0]).toMatchObject({
      sourceId: 'mta-alerts',
      state: 'unavailable',
    });
  });

  it('"are there incidents on the 7?": none in force when the alerts are fresh', async () => {
    const { app } = harness({ served: SERVED, city: CITY });
    const turn = await device(app).say('Are there any incidents on the 7?');
    expect(turn.reply).toContain('There are no incidents in force on the 7.');
    expect(turn.city[0]).toMatchObject({ kind: 'incidents', subject: '7', level: 'clear' });
  });

  it('an old copy of the alerts never says there are none', async () => {
    const stale = {
      'mta-alerts': { data: mtaAlertsData(), state: 'stale', ageMinutes: 30 },
    } as const;
    const { app } = harness({ served: stale, city: CITY });
    const turn = await device(app).say('¿Hay incidencias en el 7?', 'es');
    expect(turn.reply).toContain(
      'Las incidencias que tengo de la 7 son demasiado antiguas para decir que no hay.',
    );
    expect(turn.city[0]).toMatchObject({ level: 'unknown' });
  });

  it('"¿hay avisos en el ferri?" reads both ferry operators', async () => {
    const served = {
      'nyc-ferry-alerts': {
        data: ferryAlertsData('East River route: boats run every 40 minutes.'),
      },
      'ny-waterway-alerts': { data: ferryAlertsData(null) },
    };
    const { app } = harness({ served });
    const turn = await device(app).say('¿Hay avisos en el ferri?', 'es');
    expect(turn.reply).toContain('Hay 1 incidencia en vigor en los ferris');
    expect(turn.reply).toContain('East River route: boats run every 40 minutes.');
    expect(turn.city[0]?.sources.map((source) => source.sourceId)).toEqual([
      'nyc-ferry-alerts',
      'ny-waterway-alerts',
    ]);
  });

  it('"how is PATH?" tells the open incidents only', async () => {
    const { app } = harness({ served: { 'path-alerts': { data: pathAlertsData() } } });
    const turn = await device(app).say('How is PATH?');
    expect(turn.reply).toContain('There is 1 alert in force on PATH.');
    expect(turn.reply).toContain('HOB-WTC delayed.');
    expect(turn.reply).not.toContain('resumed');
  });
});

describe('Sara answers where vehicles are', () => {
  it('"where is the M15?": the bus by GPS, its margin and its next stop', async () => {
    const { app } = harness({ served: SERVED, city: CITY });
    const turn = await device(app).say('Where is the M15?');
    expect(turn.reply).toContain(
      'Vehicles of M15 followed live now: 1; the soonest at their next stop first:',
    );
    expect(turn.reply).toContain(
      'M15 7652 to South Ferry: GPS position of 6:59 am (±25 m). Next stop: 1 Av/E 23 St at 7:03 am.',
    );
    expect(turn.city[0]?.items[0]?.at).toBe('2026-11-11T11:59:30.000Z');
  });

  it('"¿dónde está la A?": trains placed by station, never by GPS', async () => {
    const { app } = harness({ served: SERVED, city: CITY });
    const turn = await device(app).say('¿Dónde está la A?', 'es');
    expect(turn.reply).toContain(
      'A hacia Far Rockaway-Mott Av: llegando a 59 St-Columbus Circle, situado con las ' +
        'predicciones de la MTA de las 6:59.',
    );
  });

  it('says it cannot see the line when the live data of its mode is down', async () => {
    const down = fakeCity({ modes: [modeSummary('bus', 'unavailable', ['mta-bus-positions'])] });
    const { app } = harness({ city: down });
    const turn = await device(app).say('Where is the M15?');
    expect(turn.reply).toContain("I can't see M15 live right now.");
    expect(turn.city).toEqual([]);
  });

  it('"¿dónde está mi bus?" without a trip says it does not know which one', async () => {
    const { app } = harness({ city: CITY });
    const turn = await device(app).say('¿Dónde está mi bus?', 'es');
    expect(turn.reply).toContain('No tienes ningún viaje en seguimiento ni planificado conmigo');
  });
});

describe("Sara answers from MovIQ's own statistics", () => {
  it('says there is not enough data while the recorder publishes none', async () => {
    const { app } = harness();
    const turn = await device(app).say('¿Suele ir bien la línea 7 a esta hora?', 'es');
    expect(turn.reply).toContain(
      'Aún no hay datos suficientes para decir cómo suele ir la 7 a esta hora.',
    );
    expect(turn.city[0]).toMatchObject({ kind: 'line-reliability', level: 'unknown' });
    expect(turn.city[0]?.sources[0]?.sourceId).toBe('moviq-recorder-stats');
  });

  it('gives the figure, the count of measures and the day once the recorder has them', async () => {
    const { app } = harness({ served: { 'moviq-recorder-stats': { data: recorderStatsData() } } });
    const turn = await device(app).say('Is the 7 usually on time at this hour?');
    expect(turn.reply).toContain(
      'Measured by MovIQ on 2026-11-10, a weekday, in the morning peak (6–10 h):',
    );
    expect(turn.reply).toContain(
      'Direction N: one every 4 min at the median, 9 min at the 90th percentile, over 63 ' +
        'intervals; 5 came bunched.',
    );
    expect(turn.reply).not.toContain('Direction S');
    expect(turn.city[0]?.items.map((item) => item.text)).toContain(
      'Stoppages observed in that band: 1.',
    );
  });
});
