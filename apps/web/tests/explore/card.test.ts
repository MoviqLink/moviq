import { describe, expect, it } from 'vitest';

import {
  ageText,
  compassPoint,
  courseText,
  formatMargin,
  punctuality,
  roundSpeed,
  signalBars,
  stopName,
} from '../../src/features/explore/model/card';
import { exploreEn } from '../../src/features/explore/texts-en';
import { exploreEs } from '../../src/features/explore/texts-es';

describe('the vehicle card, written as Vektia writes it', () => {
  it('fills the signal bars with how recent the last report is', () => {
    expect([0, 29, 30, 59, 60, 119, 120, 900].map(signalBars)).toEqual([4, 4, 3, 3, 2, 2, 1, 1]);
  });

  it('never states a margin more precisely than it was measured', () => {
    expect(formatMargin(4, 'en-US')).toBe('± 10 m');
    expect(formatMargin(83, 'en-US')).toBe('± 80 m');
    expect(formatMargin(140, 'en-US')).toBe('± 150 m');
    expect(formatMargin(1240, 'es-ES')).toBe('± 1,2 km');
    expect(formatMargin(1240, 'en-US')).toBe('± 1.2 km');
  });

  it('normalizes the course and writes it without leading zeroes', () => {
    expect(courseText(7.4)).toBe('7°');
    expect(courseText(29)).toBe('29°');
    expect(courseText(343.41)).toBe('343°');
    expect(courseText(359.6)).toBe('0°');
    expect(courseText(360)).toBe('0°');
    expect(courseText(-1)).toBe('359°');
    expect(courseText(-360)).toBe('0°');
    expect(exploreEn.points[compassPoint(343.41)]).toBe('North-northwest');
    expect(exploreEs.points[compassPoint(90)]).toBe('Este');
    expect(exploreEs.points[compassPoint(-90)]).toBe('Oeste');
  });

  it('rounds speeds and calls under 1 km/h standing still', () => {
    expect(roundSpeed(15.04)).toBe(15);
    expect(roundSpeed(0.4)).toBeNull();
    expect(roundSpeed(0.6)).toBe(1);
  });

  it('is on time within two minutes either way, then late or early by whole minutes', () => {
    expect(punctuality(-147)).toEqual({ kind: 'on-time' });
    expect(punctuality(120)).toEqual({ kind: 'on-time' });
    expect(punctuality(150)).toEqual({ kind: 'late', minutes: 3 });
    expect(punctuality(481)).toEqual({ kind: 'late', minutes: 8 });
    expect(punctuality(-462)).toEqual({ kind: 'early', minutes: 8 });
  });

  it('writes ages in seconds, minutes and hours', () => {
    expect(ageText(18.7)).toBe('18 s');
    expect(ageText(-3)).toBe('0 s');
    expect(ageText(241)).toBe('4 min');
    expect(ageText(3_900)).toBe('1 h 5 min');
    expect(ageText(7_200)).toBe('2 h');
  });

  it('writes bus stops in title case and keeps initials and mixed case as they are', () => {
    expect(stopName('MERRICK BLVD/MONTAUK ST')).toBe('Merrick Blvd/Montauk St');
    expect(stopName('168 ST/JAMAICA BUS TERMINAL')).toBe('168 St/Jamaica Bus Terminal');
    expect(stopName('JFK AIRPORT/TERMINAL 4')).toBe('JFK Airport/Terminal 4');
    expect(stopName('Inwood-207 St')).toBe('Inwood-207 St');
  });
});

describe('Explore in two languages', () => {
  const keys = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`))
      : [prefix];

  it('has the same words in English and Spanish', () => {
    expect(keys(exploreEs)).toEqual(keys(exploreEn));
    expect(exploreEs.points).toHaveLength(16);
  });
});
