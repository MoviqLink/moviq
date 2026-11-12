import type { LiveVehicle, TimedStop } from '@moviq/contracts';

/** Seconds from `instant` to `now`, never negative. */
export const secondsSince = (instant: string, now: number): number =>
  Math.max(0, (now - Date.parse(instant)) / 1000);

/** The time a stop is expected: its arrival, or its departure when only that is given. */
export const stopTime = (stop: TimedStop): string | null => stop.arrival ?? stop.departure;

/** The first stop still ahead at `now`, or the first listed when every time has just passed. */
export function nextStop(vehicle: LiveVehicle, now: number): TimedStop | undefined {
  return (
    vehicle.stops.find((stop) => Date.parse(stopTime(stop) ?? '') >= now - 30_000) ??
    vehicle.stops[0]
  );
}

/** Vehicles nearest to a point, for the list a keyboard can reach. */
export function nearest(
  vehicles: readonly LiveVehicle[],
  center: readonly [number, number],
  count: number,
): LiveVehicle[] {
  const scale = Math.cos((center[1] * Math.PI) / 180);
  const distance = (vehicle: LiveVehicle) =>
    ((vehicle.position.lon - center[0]) * scale) ** 2 + (vehicle.position.lat - center[1]) ** 2;
  return [...vehicles].sort((a, b) => distance(a) - distance(b)).slice(0, count);
}
