import type { Flight } from '@moviq/contracts';

/** Be at the airport this long before the flight leaves. */
const AIRPORT_MARGIN_MINUTES = 120;

const MINUTE_MS = 60_000;

/** The departure to plan from: the airline's or the airport's revised time, else the timetable. */
export function plannedDeparture(flight: Flight): Date {
  const revised = flight.revisedDeparture;
  return new Date(revised?.kind === 'revised' ? revised.at : flight.departureAt);
}

/** When to be at the airport for a departure. */
export function deadlineFor(departure: Date): Date {
  return new Date(departure.getTime() - AIRPORT_MARGIN_MINUTES * MINUTE_MS);
}
