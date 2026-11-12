import { journeySchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { stepFreeLead } from '../src/features/trip/model/step-free';
import { stepFreeEn, stepFreeEs } from '../src/features/trip/step-free-texts';
import { stepFreeJourney } from './fixtures/step-free';

const NOW = Date.parse('2026-11-11T15:00:00.000Z');

function shape(value: unknown, path = ''): string[] {
  if (typeof value === 'function') return [`${path}: function/${String(value.length)}`];
  if (typeof value === 'string') return [`${path}: string`];
  if (typeof value !== 'object' || value === null) return [`${path}: ${typeof value}`];
  return Object.entries(value).flatMap(([key, child]) =>
    shape(child, path === '' ? key : `${path}.${key}`),
  );
}

describe('the step-free section of the trip', () => {
  it('says clear only when every platform keeps the route and the outages were read', () => {
    const clear = stepFreeJourney(NOW, 'clear').itinerary.accessibility;
    expect(stepFreeLead(clear)).toEqual({ kind: 'clear', checkedAt: '2026-11-11T14:58:00.000Z' });
    const out = stepFreeJourney(NOW, 'elevator-out').itinerary.accessibility;
    expect(stepFreeLead(out)).toEqual({
      kind: 'elevator-out',
      station: 'Grand Central-42 St',
      elevator: 'EL723',
    });
    const down = stepFreeJourney(NOW, 'lists-down').itinerary.accessibility;
    expect(stepFreeLead(down)).toEqual({ kind: 'unchecked' });
    expect(stepFreeLead(undefined)).toEqual({ kind: 'not-checked' });
    expect(stepFreeLead(null)).toEqual({ kind: 'not-checked' });
  });

  it('never calls a platform that cannot be confirmed step-free', () => {
    const clear = stepFreeJourney(NOW, 'clear').itinerary.accessibility;
    if (clear === null || clear === undefined) throw new Error('fixture');
    const [first, ...rest] = clear.platforms;
    if (first === undefined) throw new Error('fixture');
    const unknown = { ...first, state: 'unknown' as const, cause: 'note' as const };
    expect(stepFreeLead({ ...clear, platforms: [unknown, ...rest] })).toEqual({
      kind: 'unconfirmed',
      station: '34 St-Penn Station',
    });
  });

  it('writes the sentences of the trip in English and Spanish', () => {
    expect(stepFreeEs.lead.clear('05:20')).toBe(
      'Estaciones accesibles según la MTA y sin averías de ascensor comunicadas a las 05:20.',
    );
    expect(stepFreeEs.change('Times Sq-42 St', 'Times Sq-42 St')).toBe(
      'La MTA no publica los recorridos dentro de las estaciones: el transbordo en Times Sq-42 St ' +
        'no está comprobado.',
    );
    expect(stepFreeEn.change('5 Av', '42 St-Bryant Pk')).toBe(
      'The MTA does not publish the routes inside stations: the change from 5 Av to ' +
        '42 St-Bryant Pk is not verified.',
    );
    expect(stepFreeEs.refused(stepFreeEs.reasons['lists-unavailable'])).toBe(
      'No podemos garantizar un viaje sin escalones ahora: las listas de estaciones accesibles y ' +
        'ascensores de la MTA no están disponibles.',
    );
    expect(stepFreeEn.modesLeftOut(['bus', 'ferry'])).toBe(
      'Buses and ferries were left out: their timetables do not say which stops are step-free.',
    );
    expect(stepFreeEs.modesLeftOut(['bus'])).toBe(
      'Los autobuses quedan fuera: sus horarios no dicen qué paradas no tienen escalones.',
    );
    expect(stepFreeEs.lead['elevator-out']('Grand Central-42 St', 'EL723')).toBe(
      'Ahora no es sin escalones: la MTA comunica averiado el ascensor EL723 en Grand Central-42 St.',
    );
  });

  it('has the same words in both languages, and fixtures that match the contract', () => {
    expect(shape(stepFreeEs).sort()).toEqual(shape(stepFreeEn).sort());
    for (const variant of ['clear', 'elevator-out', 'lists-down'] as const) {
      expect(journeySchema.safeParse(stepFreeJourney(NOW, variant)).error).toBeUndefined();
    }
  });

  it('still reads a journey kept before the step-free check existed', () => {
    const kept = stepFreeJourney(NOW, 'clear');
    const { accessibility: _dropped, ...itinerary } = kept.itinerary;
    const { stepFreeRefusal: _none, ...watch } = kept.watch;
    const parsed = journeySchema.parse({ ...kept, itinerary, watch });
    expect(parsed.itinerary.accessibility).toBeUndefined();
    expect(parsed.watch.stepFreeRefusal).toBeNull();
    expect(stepFreeLead(parsed.itinerary.accessibility)).toEqual({ kind: 'not-checked' });
  });
});
