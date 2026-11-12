import { liveVehiclesResponseSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { nearest, nextStop } from '../../src/features/explore/model/vehicle';
import live from './fixtures/live-city.json';

describe('the live city captured from the API', () => {
  const city = liveVehiclesResponseSchema.parse(live);

  it('matches the contract and holds buses with a computed speed and trains by station', () => {
    const buses = city.vehicles.filter((vehicle) => vehicle.mode === 'bus');
    expect(buses.some((bus) => bus.speed?.basis === 'computed')).toBe(true);
    const trains = city.vehicles.filter((vehicle) => vehicle.mode === 'subway');
    expect(trains.every((train) => train.position.basis === 'predicted')).toBe(true);
  });

  it('finds the next stop still ahead and the vehicles nearest a point', () => {
    const bus = city.vehicles.find((vehicle) => vehicle.id === 'bus:MTA NYCT_8440');
    if (bus === undefined) throw new Error('bus 8440 is in the capture');
    expect(nextStop(bus, Date.parse('2026-11-11T01:07:10Z'))?.id).toBe('500551');
    expect(nextStop(bus, Date.parse('2026-11-11T01:00:00Z'))?.id).toBe('500549');
    const near = nearest(city.vehicles, [-73.76, 40.679], 3);
    expect(near[0]?.id).toBe('bus:MTA NYCT_8440');
    expect(near).toHaveLength(3);
  });
});
