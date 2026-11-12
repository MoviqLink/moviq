import type { FlightFinder, FlightQuery } from '../../journeys/ports.js';
import { readFlight } from './aerodatabox-answer.js';
import {
  AERODATABOX_HOST,
  createAeroDataBoxGateway,
  type AeroDataBoxGateway,
  type AeroDataBoxOptions,
} from './aerodatabox-gateway.js';
import { FLIGHT_STATUS_UNITS } from './aerodatabox-units.js';
import { failure } from './outcome.js';

export {
  AERODATABOX_HOST,
  aeroDataBoxCredential,
  type AeroDataBoxCredential,
} from './aerodatabox-gateway.js';

const MAX_BYTES = 256 * 1024;

/**
 * Flight Status (single day) of AeroDataBox, through the process's gateway, which it shares with
 * the airport boards; given its options alone, it has a gateway of its own.
 */
export function createAeroDataBoxFlights(
  through: AeroDataBoxGateway | AeroDataBoxOptions,
): FlightFinder {
  const gateway = 'get' in through ? through : createAeroDataBoxGateway(through);
  return {
    sourceId: 'aerodatabox',
    async find(query, signal) {
      const problem = gateway.configured ? queryProblem(query) : undefined;
      if (problem !== undefined) return failure('unavailable', 'bad-query', problem);
      const answer = await gateway.get(
        { url: flightUrl(query), units: FLIGHT_STATUS_UNITS, maxBytes: MAX_BYTES },
        { lookedUp: 'flights' },
        signal,
      );
      if (!answer.ok) return answer;
      return readFlight(answer.value, query, answer.value.receivedAt);
    },
  };
}

function queryProblem(query: FlightQuery): string | undefined {
  if (!/^[A-Z0-9]{2,3}$/.test(query.carrier)) return 'The carrier code is not 2 or 3 letters.';
  if (!/^\d{1,4}$/.test(query.number)) return 'The flight number is not 1 to 4 digits.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) return 'The date is not written YYYY-MM-DD.';
  return undefined;
}

/** "Flight Status (single day)": the flights of that number departing on that local date. */
export function flightUrl(query: FlightQuery): string {
  const params = new URLSearchParams({
    dateLocalRole: 'Departure',
    withAircraftImage: 'false',
    withLocation: 'false',
    // A flight plan may bill the request twice (OpenAPI 1.15.4.0): never asked.
    withFlightPlan: 'false',
  });
  const number = encodeURIComponent(`${query.carrier}${query.number}`);
  return `https://${AERODATABOX_HOST}/flights/number/${number}/${query.date}?${params.toString()}`;
}
