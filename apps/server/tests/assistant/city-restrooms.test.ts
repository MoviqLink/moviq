import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Database } from '../../src/infrastructure/database/database.js';
import { restroomsCard } from '../../src/modules/assistant/city/words-restrooms.js';
import { telling } from '../../src/modules/assistant/city/words-common.js';
import { readCityQuestion } from '../../src/modules/assistant/understanding/city-question.js';
import { nycPublicRestrooms } from '../../src/modules/data-platform/sources/street/public-restrooms.js';
import { accepted, capture } from '../sources/ny511/captures.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import type { TempDatabase } from '../support/temp-database.js';
import { CITY_NOW, type Served } from './city-doubles.js';
import { stationsData } from './city-data.js';
import { assistantDatabase, calls, scriptedModel, text } from './doubles.js';
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

const restrooms = accepted(
  nycPublicRestrooms.parse(capture('street', 'public-restrooms.json'), {
    receivedAt: new Date('2026-11-11T11:00:00Z'),
    previous: undefined,
  }),
).data;

const columbusCircle = {
  readAt: '2026-11-11T11:00:00.000Z',
  entrances: [
    {
      stations: ['A24'],
      complex: '614',
      name: '59 St-Columbus Circle',
      type: 'Stair',
      entry: true,
      exit: true,
      point: [-73.9819, 40.7681],
    },
  ],
};

const SERVED: Readonly<Record<string, Served>> = {
  'nyc-public-restrooms': { data: restrooms },
  'mta-subway-stations': { data: stationsData() },
  'mta-subway-entrances': { data: columbusCircle },
};

const outputSchema = z.object({ result: z.record(z.string(), z.unknown()) });

describe('Sara finds a free public restroom in basic mode', () => {
  it('near the next stops of the trip, in a straight line, with the hours as published', async () => {
    const traveller = device(harness({ served: SERVED }).app);
    await traveller.say('Bryant Park at 7 pm from 125 Street');
    const turn = await traveller.say('Is there a restroom on my way?');
    expect(turn.mode).toBe('basic');
    expect(turn.reply).toContain(
      'Free public restrooms near your next stops (Bryant Park, Manhattan, New York, NY), in a ' +
        'straight line:',
    );
    expect(turn.reply).toContain(
      'Bryant Park: 60 m in a straight line from Bryant Park, Manhattan, New York, NY. ' +
        'Accessibility not given. Hours as published: 8am-4pm, Open later seasonally.',
    );
    const [card] = turn.city;
    expect(card).toMatchObject({ kind: 'restrooms', level: 'info' });
    expect(card?.items).toHaveLength(3);
    expect(card?.sources[0]).toMatchObject({ sourceId: 'nyc-public-restrooms', state: 'healthy' });
    expect(turn.reply).not.toMatch(/\$|pay|price/i);
  });

  it('"¿hay un baño cerca de Bryant Park?": the place found, the hours in English said so', async () => {
    const turn = await device(harness({ served: SERVED }).app).say(
      '¿Hay un baño cerca de Bryant Park?',
      'es',
    );
    expect(turn.reply).toContain(
      'Aseos públicos gratuitos cerca de Bryant Park, Manhattan, New York, NY, en línea recta:',
    );
    expect(turn.reply).toContain('a 60 m en línea recta de Bryant Park');
    expect(turn.reply).toContain('Horario publicado, en inglés: 8am-4pm, Open later seasonally.');
  });

  it('near a station by name, and says so when none is within 800 m', async () => {
    const turn = await device(harness({ served: SERVED }).app).say(
      'Any restroom near 59 St-Columbus Circle station?',
    );
    expect(turn.reply).toContain(
      'No public restroom in service within 800 m in a straight line of 59 St-Columbus Circle.',
    );
    expect(turn.city[0]?.sources.map((source) => source.sourceId)).toEqual([
      'nyc-public-restrooms',
      'mta-subway-entrances',
    ]);
  });

  it('never says there is none when the list cannot be read, nor guesses a trip', async () => {
    const traveller = device(harness({ served: {} }).app);
    const noTrip = await traveller.say('Where is a bathroom on my trip?');
    expect(noTrip.reply).toContain('You have no trip under watch or planned with me');
    const turn = await traveller.say('¿Hay aseos cerca de Bryant Park?', 'es');
    expect(turn.reply).toContain('Ahora no puedo leer la lista de aseos públicos de la ciudad.');
    expect(turn.reply).not.toMatch(/no hay ningún aseo/i);
    expect(turn.city[0]).toMatchObject({ kind: 'restrooms', level: 'unknown' });
  });

  it('says first, and plainly, that the fully accessible ones lead on a step-free trip', () => {
    const card = restroomsCard(
      {
        kind: 'restrooms',
        scope: 'trip',
        subject: 'Grand Central-42 St',
        stepFree: true,
        withinMetres: 800,
        restrooms: [
          {
            name: '120 Park Avenue POPS',
            near: 'Grand Central-42 St',
            straightMetres: 120,
            hours: 'Monday to Saturday: 7:30 am-9:30 pm',
            season: 'year-round',
            access: 'full',
            keyOrCode: true,
          },
        ],
        sources: [],
      },
      telling('es', new Date(CITY_NOW)),
    );
    expect(card.headline).toContain(
      'Tu viaje es sin escalones: primero van los totalmente accesibles.',
    );
    expect(card.items[0]?.text).toContain('Totalmente accesible.');
    expect(card.items[0]?.text).toContain('Hace falta llave o código: pregunta allí.');
  });
});

describe('Sara with a model finds a restroom through restrooms_near', () => {
  it('keeps words with the distance and hours the tool gave, never coordinates', async () => {
    const words =
      'Bryant Park has a free restroom 60 m away in a straight line, open 8 am to 4 pm.';
    const model = scriptedModel([
      calls(['restrooms_near', { near: 'place', name: 'Bryant Park' }]),
      text(words),
    ]);
    const turn = await device(harness({ model, served: SERVED }).app).say(
      'Where can I find a toilet near Bryant Park?',
    );
    expect(turn.reply).toBe(words);
    const output = outputSchema.parse(JSON.parse(model.results[1]?.[0]?.output ?? '{}'));
    expect(output.result).toMatchObject({ kind: 'restrooms', scope: 'place' });
    expect(JSON.stringify(output)).not.toMatch(/40\.\d{4}/);
  });

  it('replaces words with an hour or a distance no tool gave by the fixed reply', async () => {
    for (const words of [
      'Bryant Park has a free restroom, open until 9:30 pm.',
      'Bryant Park has a free restroom 55 m away.',
    ]) {
      const model = scriptedModel([
        calls(['restrooms_near', { near: 'place', name: 'Bryant Park' }]),
        text(words),
      ]);
      const turn = await device(harness({ model, served: SERVED }).app).say(
        'Where can I find a toilet near Bryant Park?',
      );
      expect(turn.reply).toContain('Free public restrooms near Bryant Park');
    }
  });

  it('asks for the name when the place or stop has none', async () => {
    const model = scriptedModel([
      calls(['restrooms_near', { near: 'stop', name: null }]),
      text('Which station do you mean?'),
    ]);
    await device(harness({ model, served: SERVED }).app).say('A restroom near my station?');
    expect(model.results[1]?.[0]?.output).toContain('near stop needs its name.');
  });
});

describe('the basic reader of restroom questions', () => {
  const read = (said: string) => readCityQuestion(said, new Date(CITY_NOW));

  it('reads the trip, a station or a place, in English and Spanish', () => {
    expect(read('Is there a restroom on my way?')).toEqual({
      tool: 'restrooms',
      near: { by: 'trip' },
    });
    expect(read('¿Dónde hay un baño?')).toEqual({ tool: 'restrooms', near: { by: 'trip' } });
    expect(read('¿Hay aseos por el camino?')).toEqual({ tool: 'restrooms', near: { by: 'trip' } });
    expect(read('Toilet near 59 St station')).toEqual({
      tool: 'restrooms',
      near: { by: 'stop', name: '59 St' },
    });
    expect(read('¿Hay un baño accesible cerca de Bryant Park?')).toEqual({
      tool: 'restrooms',
      near: { by: 'place', name: 'Bryant Park' },
    });
  });

  it('leaves other questions to the other tools', () => {
    expect(read('Is the elevator at 59 St working?')).toMatchObject({ tool: 'station-access' });
  });
});
