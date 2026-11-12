import { describe, expect, it } from 'vitest';

import { flightView } from '../src/features/trip/model/flight';
import { tripEn, tripEs } from '../src/features/trip/texts';
import { journey } from './fixtures/journeys';

const NOW = Date.parse('2026-11-11T20:00:00.000Z');

describe('the flight of the trip', () => {
  it("shows AeroDataBox's revised time, terminal, gate and status, each with its source", () => {
    const view = flightView(journey(NOW, 'en', false));
    expect(view).toMatchObject({
      code: 'AA 2215',
      airport: 'LGA',
      scheduled: { sourceId: 'aerodatabox' },
      revised: { value: { kind: 'revised', minutes: 20 }, sourceId: 'aerodatabox' },
      terminal: { value: 'B', sourceId: 'aerodatabox' },
      gate: { value: 'B12', sourceId: 'aerodatabox' },
      status: { value: { kind: 'status', word: 'Delayed' }, sourceId: 'aerodatabox' },
      departure: { basis: 'revised', sourceId: 'aerodatabox' },
      discrepancies: [],
    });
    expect(view?.aerodatabox).not.toBeNull();
  });

  it('says where the boarding pass and AeroDataBox disagree', () => {
    const view = flightView(journey(NOW, 'en', true));
    expect(view?.discrepancies).toHaveLength(1);
    expect(view?.discrepancies[0]).toMatch(/^Your boarding pass says \d\d:\d\d; AeroDataBox says/);
  });

  it('from the boarding pass alone: no gate, status or revised time, and no AeroDataBox credit', () => {
    const base = journey(NOW, 'en', true);
    const view = flightView({ ...base, watch: { ...base.watch, flight: null } });
    expect(view).toMatchObject({
      scheduled: { sourceId: 'boarding-pass' },
      revised: null,
      terminal: { value: 'B', sourceId: 'boarding-pass' },
      gate: null,
      status: null,
      departure: null,
      aerodatabox: null,
    });
  });

  it("shows the aircraft's movement from ADS-B before AeroDataBox's status word", () => {
    const base = journey(NOW, 'en', false);
    const check = base.watch.flight;
    if (check === null) throw new Error('fixture');
    const moving = {
      ...base,
      watch: {
        ...base.watch,
        flight: {
          ...check,
          movement: { phase: 'taxiing' as const, sourceId: 'adsb-lol-new-york' },
        },
      },
    };
    expect(flightView(moving)?.status).toMatchObject({
      value: { kind: 'movement', phase: 'taxiing' },
      sourceId: 'adsb-lol-new-york',
    });
    expect(tripEn.flightPanel.sources['adsb-lol-new-york']).toBe('ADS-B · adsb.lol');
    expect(tripEs.flightPanel.movement.taxiing).toBe('Rodando hacia la pista');
  });

  it('has nothing to show for a trip without a flight', () => {
    const base = journey(NOW, 'en', false);
    expect(flightView({ ...base, request: { ...base.request, flight: null } })).toBeNull();
  });

  it('says how much the departure moved, in both languages', () => {
    expect([20, -5, 0].map(tripEn.flightPanel.shift)).toEqual([
      '20 min later',
      '5 min earlier',
      'on time',
    ]);
    expect(tripEs.flightPanel.shift(20)).toBe('20 min más tarde');
  });
});
