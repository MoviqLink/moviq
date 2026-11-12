import type { Itinerary, TravelMode } from '@moviq/contracts';

import type { Lang } from '../../shared/i18n/lang';
import { sampleDate, type SampleTrip } from '../triplog/sample';

import { fromNyWallClock } from './ny-time';
import { modeName, ROADMAP_TEXT, type RoadmapLeg, type RoadmapMode } from './roadmap-text';

/** Minutes left between two legs of a sample trip to change trains or buses. */
const SAMPLE_TRANSFER_MINUTES = 3;
const MINUTE = 60_000;

const ROADMAP_MODE: Readonly<Record<TravelMode, RoadmapMode>> = {
  walk: 'walk',
  subway: 'subway',
  bus: 'bus',
  rail: 'rail',
  ferry: 'ferry',
  taxi: 'other',
};

/** A walk between two rides is a transfer; a walk at either end of the trip is a walk. */
function isTransfer(legs: Itinerary['legs'], index: number): boolean {
  const before = legs[index - 1];
  const after = legs[index + 1];
  return (
    legs[index]?.mode === 'walk' &&
    before !== undefined &&
    after !== undefined &&
    before.mode !== 'walk' &&
    after.mode !== 'walk'
  );
}

/** An itinerary planned by Sara, leg by leg, with the times its sources gave. */
export function roadmapFromItinerary(itinerary: Itinerary, lang: Lang = 'en'): RoadmapLeg[] {
  return itinerary.legs.map((leg, index) => {
    const mode = ROADMAP_MODE[leg.mode];
    return {
      id: `${itinerary.id}-${String(index)}`,
      name: isTransfer(itinerary.legs, index) ? ROADMAP_TEXT[lang].transfer : modeName(mode, lang),
      mode,
      line: leg.route?.shortName ?? null,
      from: leg.from.label,
      to: leg.to.label,
      start: new Date(leg.departAt),
      end: new Date(leg.arriveAt),
    };
  });
}

/** The minutes of each ride: the planned time less the transfers, shared out evenly. */
function rideMinutes(trip: SampleTrip): number[] {
  const count = trip.legs.length;
  const riding = Math.max(count, trip.plannedMinutes - SAMPLE_TRANSFER_MINUTES * (count - 1));
  const share = Math.floor(riding / count);
  return trip.legs.map((_, index) => (index === count - 1 ? riding - share * (count - 1) : share));
}

/**
 * A sample trip as a roadmap. The sample keeps only its lines and planned minutes, so the rides
 * share that time evenly, with a short transfer between two of them; the stations where one ends
 * and the next begins are named by the change of line, never invented.
 */
export function roadmapFromSample(trip: SampleTrip, today?: Date, lang: Lang = 'en'): RoadmapLeg[] {
  const text = ROADMAP_TEXT[lang];
  const minutes = rideMinutes(trip);
  let at = fromNyWallClock(sampleDate(trip, today)).getTime();
  return trip.legs.flatMap((leg, index) => {
    const before = trip.legs[index - 1];
    const after = trip.legs[index + 1];
    const transfer: RoadmapLeg[] = [];
    if (before !== undefined) {
      const start = at;
      at += SAMPLE_TRANSFER_MINUTES * MINUTE;
      transfer.push({
        id: `${trip.id}-transfer-${String(index)}`,
        name: text.transfer,
        mode: 'walk',
        line: null,
        from: before.line,
        to: leg.line,
        start: new Date(start),
        end: new Date(at),
      });
    }
    const start = at;
    at += (minutes[index] ?? 0) * MINUTE;
    return [
      ...transfer,
      {
        id: `${trip.id}-${String(index)}`,
        name: modeName(leg.mode, lang),
        mode: leg.mode,
        line: leg.line,
        from: before === undefined ? trip.from : text.changeFrom(before.line),
        to: after === undefined ? trip.to : text.changeTo(after.line),
        start: new Date(start),
        end: new Date(at),
      },
    ];
  });
}
