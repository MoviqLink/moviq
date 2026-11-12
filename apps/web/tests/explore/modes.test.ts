import { liveVehiclesResponseSchema, type LivePosition } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import {
  stationFeatures,
  vehicleFeatures,
  vehicleSymbol,
} from '../../src/features/explore/map/marks';
import {
  dayRange,
  durationText,
  minutesUntil,
  shipCategory,
  stallOf,
} from '../../src/features/explore/model/modes';
import { exploreEn } from '../../src/features/explore/texts-en';
import { exploreEs } from '../../src/features/explore/texts-es';
import airSea from './fixtures/live-air-sea.json';
import shuttles from './fixtures/live-shuttles.json';
import city from './fixtures/live-city.json';

describe('the words of the modes that run no line', () => {
  it('names AIS ship types by their group in the standard', () => {
    expect(shipCategory(60)).toBe('passenger');
    expect(shipCategory(69)).toBe('passenger');
    expect(shipCategory(52)).toBe('tug');
    expect(shipCategory(31)).toBe('towing');
    expect(shipCategory(79)).toBe('cargo');
    expect(shipCategory(1)).toBe('unspecified');
    expect(shipCategory(null)).toBe('unspecified');
  });

  it('counts the minutes to a train, and writes days and durations as a reader expects', () => {
    const now = Date.parse('2026-11-11T02:25:00Z');
    expect(minutesUntil('2026-11-11T02:29:59Z', now)).toBe(4);
    expect(minutesUntil('2026-11-11T02:24:40Z', now)).toBe(0);
    expect(dayRange('2026-11-04T05:00:00Z', '2026-11-10T20:00:00Z', 'es')).toEqual({
      from: '4',
      to: '10 de noviembre',
    });
    expect(dayRange('2026-10-30T15:00:00Z', '2026-11-05T15:00:00Z', 'en-US')).toEqual({
      from: 'October 30',
      to: 'November 5',
    });
    expect(durationText(372)).toBe('6 min');
    expect(durationText(45)).toBe('45 s');
  });

  it('tells a possible stoppage in one sentence, with its evidence', () => {
    const position: LivePosition = {
      lat: 40.77,
      lon: -73.98,
      basis: 'predicted',
      marginMeters: 120,
      dataTime: '2026-11-11T01:06:03.000Z',
      station: { id: '123N', name: '72 St', status: 'heading' },
      stall: {
        elapsedSeconds: 372,
        usualSeconds: 126,
        medianSeconds: 95,
        n: 312,
        from: '2026-11-04T05:00:00.000Z',
        to: '2026-11-10T20:00:00.000Z',
        leftStop: { id: '124N', name: '59 St' },
      },
    };
    const stall = stallOf(position);
    if (stall === null) throw new Error('the position carries a stoppage');
    const days = dayRange(stall.from, stall.to, 'es');
    expect(
      exploreEs.craft.stall.text(
        durationText(stall.elapsedSeconds),
        stall.leftStop.name,
        stall.toStop,
        durationText(stall.usualSeconds),
      ),
    ).toBe('Lleva 6 min desde 59 St hacia 72 St; lo normal es hasta 2 min');
    expect(exploreEs.craft.stall.evidence(stall.n, days.from, days.to)).toBe(
      'p95 de 312 medidas, del 4 al 10 de noviembre',
    );
    expect(stallOf({ ...position, stall: null })).toBeNull();
  });

  it('has the same words for every mode in English and Spanish', () => {
    expect(Object.keys(exploreEs.modes)).toEqual(Object.keys(exploreEn.modes));
    expect(Object.keys(exploreEs.craft.ship.types)).toEqual(
      Object.keys(exploreEn.craft.ship.types),
    );
    expect(Object.values(exploreEn.modes).join(' ')).not.toMatch(/citi/i);
  });
});

describe('the marks of aircraft, ships, shuttles and parked vehicles', () => {
  const sky = liveVehiclesResponseSchema.parse(airSea);
  const street = liveVehiclesResponseSchema.parse(shuttles);

  it('matches the contract and draws each mode with its own silhouette, turned to its course', () => {
    const features = vehicleFeatures(sky.vehicles, new Map(), null).features;
    const icons = new Set(features.map((feature) => feature.properties['icon']));
    expect(icons).toContain('aircraft-pointer');
    expect(icons).toContain('ship-pointer');
    expect(
      sky.vehicles.every((vehicle) => vehicle.mode === 'aircraft' || vehicle.mode === 'ship'),
    ).toBe(true);
  });

  it('keeps buses upright and turns trains, aircraft and ships to their course', () => {
    const vehicle = liveVehiclesResponseSchema.parse(city).vehicles[0];
    if (vehicle === undefined) throw new Error('city fixture needs a vehicle');
    for (const mode of ['bus', 'subway', 'rail'] as const) {
      expect(
        vehicleSymbol({ ...vehicle, mode, bearing: { degrees: 90, basis: 'reported' } }),
      ).toEqual({
        icon: `${mode}-pointer`,
        bearing: mode === 'bus' ? 0 : 90,
      });
    }
    const aircraft = sky.vehicles.find(
      (vehicle) => vehicle.mode === 'aircraft' && vehicle.bearing !== null,
    );
    expect(aircraft).toBeDefined();
    if (aircraft !== undefined)
      expect(vehicleSymbol(aircraft).bearing).toBe(aircraft.bearing?.degrees);
  });

  it('draws parked vehicles and stations as places, without labels on scooters', () => {
    const parked = street.stations.filter((station) => station.mode === 'micromobility');
    expect(parked.length).toBeGreaterThan(0);
    const features = stationFeatures(parked, null).features;
    expect(features.every((feature) => feature.properties['label'] === '')).toBe(true);
    expect(features.every((feature) => feature.properties['mode'] === 'micromobility')).toBe(true);
    const counted = street.vehicles.filter((vehicle) => vehicle.occupancy !== null);
    expect(counted[0]?.occupancy).toEqual({ passengers: 64, capacity: 64 });
  });
});
