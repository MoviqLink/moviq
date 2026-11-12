import {
  nextStops,
  type Journey,
  type NearRestroom,
  type Place,
  type RestroomsNearResponse,
} from '@moviq/contracts';

/** The stops a restroom is looked for near: where the legs not yet over end, three at most. */
export const restroomStops = (journey: Journey, now: number): Place[] =>
  nextStops(journey.itinerary.legs, now);

/** Five decimals place a stop within a metre, which is all a straight line needs. */
const degrees = (value: number): string => value.toFixed(5);

/** The query of `GET /api/city/restrooms` for those stops, step-free when the trip is. */
export function restroomQuery(stops: readonly Place[], stepFree: boolean): string {
  const near = stops.map((stop) => `${degrees(stop.lat)},${degrees(stop.lon)}`).join(';');
  return `near=${encodeURIComponent(near)}${stepFree ? '&stepFree=1' : ''}`;
}

/** One stop and the restrooms found nearest to it, nearest or fully accessible first. */
export interface StopRestrooms {
  readonly stop: string;
  readonly restrooms: readonly NearRestroom[];
}

/** The answer by stop, in the order of the trip; a stop with none found is left out. */
export function byStop(answer: RestroomsNearResponse, stops: readonly Place[]): StopRestrooms[] {
  return stops.flatMap((stop, index) => {
    const restrooms = (answer.restrooms ?? []).filter((restroom) => restroom.near === index);
    return restrooms.length === 0 ? [] : [{ stop: stop.label, restrooms }];
  });
}

/** The published hours on one line, their own lines kept apart by a middle dot. */
export const hoursLine = (hours: string): string => hours.split('\n').join(' · ');
