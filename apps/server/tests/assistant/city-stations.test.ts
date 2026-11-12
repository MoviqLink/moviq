import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/database.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import type { TempDatabase } from '../support/temp-database.js';
import { CITY_NOW, type Served } from './city-doubles.js';
import {
  aceFeedData,
  equipmentData,
  lexFeedData,
  mtaAlertsData,
  nqrwFeedData,
  outagesData,
  stationsData,
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

const SERVED: Readonly<Record<string, Served>> = {
  'mta-subway-stations': { data: stationsData() },
  'mta-elevators': { data: outagesData() },
  'mta-elevator-equipment': { data: equipmentData() },
  'mta-subway-1234567': { data: lexFeedData() },
  'mta-subway-nqrw': { data: nqrwFeedData() },
  'mta-subway-ace': { data: aceFeedData() },
  'mta-alerts': { data: mtaAlertsData() },
};

describe('Sara answers about elevators and step-free access', () => {
  it('"¿funciona el ascensor de 59 St?" lists both stations of that name with their lines', async () => {
    const { app } = harness({ served: SERVED });
    const turn = await device(app).say('¿Funciona el ascensor de 59 St?', 'es');
    expect(turn.reply).toContain('Hay 2 estaciones que encajan con «59 St».');
    expect(turn.reply).toContain('59 St (4): sin escalones; 1 fuera de servicio ahora.');
    expect(turn.reply).toContain(
      '59 St (R): no accesible sin escalones; 0 fuera de servicio ahora.',
    );
    expect(turn.city[0]?.sources.map((source) => source.sourceId)).toEqual([
      'mta-subway-stations',
      'mta-elevators',
      'mta-elevator-equipment',
    ]);
  });

  it('one station: the elevator out, when it is back, whether another one stands in', async () => {
    const { app } = harness({ served: SERVED });
    const turn = await device(app).say('Is the elevator at 59 St on the 4 working?');
    expect(turn.city[0]).toMatchObject({ subject: '59 St', level: 'notice' });
    expect(turn.reply).toContain('At 59 St, out of service now: 1 elevator.');
    expect(turn.reply).toContain(
      'Elevator out of service: Street to mezzanine for service in both directions. No other ' +
        "elevator gives this access. Back by 4:00 pm, by the MTA's estimate.",
    );
    expect(turn.reply).toContain('Step-free in both directions, by the MTA.');
  });

  it('an accessible station warns that it does not guarantee the route', async () => {
    const { app } = harness({ served: SERVED });
    const turn = await device(app).say('¿Hay ascensor en 59 St-Columbus Circle?', 'es');
    expect(turn.city[0]).toMatchObject({ subject: '59 St-Columbus Circle', level: 'clear' });
    const texts = turn.city[0]?.items.map((item) => item.text);
    expect(texts).toContain(
      'Sin escalones solo en sentido norte, según la MTA. Nota de la MTA: Uptown only.',
    );
    expect(texts).toContain(
      'Que una estación sea accesible no garantiza todo el itinerario: comprueba cada estación del viaje.',
    );
  });

  it('announced work is told apart from what is out now', async () => {
    const { app } = harness({ served: SERVED });
    const turn = await device(app).say('Escalators at 59 St on the R?');
    expect(turn.city[0]).toMatchObject({ level: 'clear' });
    expect(turn.city[0]?.items[0]?.text).toContain(
      'Announced from 7:00 am tomorrow: Escalator out of service',
    );
  });

  it('cannot say an elevator works when the outages feed is down', async () => {
    const { 'mta-elevators': _, ...rest } = SERVED;
    const { app } = harness({ served: rest });
    const turn = await device(app).say('¿Funciona el ascensor de 59 St-Columbus Circle?', 'es');
    expect(turn.reply).toContain(
      'Ahora no puedo comprobar los ascensores y escaleras mecánicas de 59 St-Columbus Circle.',
    );
    expect(turn.city[0]).toMatchObject({ level: 'unknown' });
  });

  it('a station nobody knows, and a stations list that cannot be read, are said so', async () => {
    const unknown = await device(harness({ served: SERVED }).app).say('Elevators at Narnia Av?');
    expect(unknown.reply).toContain('I can\'t find a subway station called "Narnia Av".');
    const down = await device(harness().app).say('Elevators at 59 St?');
    expect(down.reply).toContain("I can't read the list of subway stations right now");
  });

  it('incidents at a station join its alerts and its elevators', async () => {
    const { app } = harness({ served: SERVED });
    const turn = await device(app).say('Any problems at 59 St on the 4?');
    expect(turn.city[0]).toMatchObject({ kind: 'incidents', subject: '59 St', level: 'notice' });
    expect(turn.reply).toContain('There are no incidents in force on 59 St.');
    expect(turn.city[0]?.items[0]?.text).toContain('Elevator out of service');
  });
});
