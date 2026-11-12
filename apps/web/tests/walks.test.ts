import type { Itinerary, Leg } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { routeFeatures } from '../src/features/trip/map/geometry';
import { stepFreeLead } from '../src/features/trip/model/step-free';
import { stepFreeEn, stepFreeEs } from '../src/features/trip/step-free-texts';
import { journeyEn, journeyEs } from '../src/shared/journey/texts';
import { isProvisional, walkNote } from '../src/shared/journey/walks';
import { journey } from './fixtures/journeys';
import { stepFreeJourney } from './fixtures/step-free';

const now = Date.parse('2026-11-11T12:00:00.000Z');

const STREET: NonNullable<Leg['walk']> = {
  basis: 'street',
  profile: 'foot',
  metres: 300,
  unchecked: null,
};
const ESTIMATED: NonNullable<Leg['walk']> = {
  basis: 'estimated',
  profile: 'foot',
  metres: null,
  unchecked: 'streets-unavailable',
};

/** The fixture's trip (walk, ride, walk) with its walks labelled as given. */
function labelled(first: Leg['walk'], last: Leg['walk']): Itinerary {
  const { itinerary } = journey(now, 'en', false);
  const legs = itinerary.legs.map((leg, index) =>
    leg.mode !== 'walk' ? leg : { ...leg, walk: index === 0 ? first : last },
  );
  return { ...itinerary, legs };
}

/** Ride, walk, ride: the walk is a change. */
function withChange(walk: Leg['walk']): Leg[] {
  const { legs } = journey(now, 'en', false).itinerary;
  const ride = legs.find((leg) => leg.mode !== 'walk');
  const step = legs.find((leg) => leg.mode === 'walk');
  if (ride === undefined || step === undefined) throw new Error('fixture');
  return [ride, { ...step, walk }, ride];
}

describe('walks as the trip shows them', () => {
  it('draws a walk on the streets along its path, an estimated one dotted', () => {
    const route = routeFeatures(labelled(STREET, ESTIMATED));
    expect(route.features.map((feature) => feature.properties.kind)).toEqual([
      'street-walk',
      'ride',
      'walk',
    ]);
    const estimated = labelled(STREET, ESTIMATED).legs[2];
    if (estimated === undefined) throw new Error('fixture');
    // Dotted from place to place, never along a path it was not walked on.
    expect(route.features[2]?.geometry.coordinates).toEqual([
      [estimated.from.lon, estimated.from.lat],
      [estimated.to.lon, estimated.to.lat],
    ]);
  });

  it('says in the row how a walk is known, and never calls an estimated change sure', () => {
    expect(walkNote(labelled(STREET, ESTIMATED).legs, 0)).toBe('street');
    expect(walkNote(labelled(STREET, ESTIMATED).legs, 2)).toBe('estimated');
    expect(walkNote(withChange(ESTIMATED), 1)).toBe('change');
    expect(walkNote(withChange({ ...ESTIMATED, basis: 'station-rule' }), 1)).toBe('station-rule');
    expect([journeyEn.walk.estimated, journeyEs.walk.estimated]).toEqual([
      'walk, estimated',
      'a pie, estimado',
    ]);
    expect([journeyEn.walk.change, journeyEs.walk.change]).toEqual([
      'change not checked',
      'transbordo sin comprobar',
    ]);
  });

  it('calls a trip with an estimated walk provisional, and one kept before labels too', () => {
    expect(isProvisional({ ...labelled(STREET, ESTIMATED), walking: 'provisional' })).toBe(true);
    expect(isProvisional({ ...labelled(STREET, STREET), walking: 'checked' })).toBe(false);
    const { walking: _kept, ...before } = labelled(undefined, undefined);
    expect(isProvisional(before)).toBe(true);
    expect(journeyEs.about('5 min de margen')).toBe('unos 5 min de margen');
  });

  it('never calls a step-free trip clear while a walk was not walked with a wheelchair', () => {
    const access = stepFreeJourney(now, 'clear').itinerary.accessibility;
    if (access === null || access === undefined) throw new Error('fixture');
    const walk = { kind: 'walk-unverified' as const, legIndex: 0 };
    const lead = stepFreeLead({ ...access, warnings: [...access.warnings, walk] });
    expect(lead).toEqual({ kind: 'walk-unchecked', step: 1 });
    expect(stepFreeEs.walk(1)).toBe(
      'Accesibilidad sin comprobar en este tramo (paso 1): es una estimación, no se ha ' +
        'recorrido por la calle en silla de ruedas.',
    );
    expect(stepFreeEn.lead['walk-unchecked'](1)).toContain('not checked on step 1');
  });
});
