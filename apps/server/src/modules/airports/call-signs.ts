import type { ScheduledFlight } from '@moviq/contracts';

import { ICAO_BY_IATA } from '../journeys/flight-callsign.js';

/** An airline call sign: its ICAO code and the flight's digits, as most airlines broadcast it. */
const AIRLINE_CALL_SIGN = /^([A-Z]{3})0*(\d{1,4})$/;
/** A flight number as AeroDataBox writes it: `AA 100`, `B6 1024`. */
const FLIGHT_NUMBER = /^([A-Z0-9]{2,3}) 0*(\d{1,4})$/;

/** IATA code by ICAO code: the airlines of the boards first, then the ones MovIQ knows. */
export function airlineCodes(flights: readonly ScheduledFlight[]): ReadonlyMap<string, string> {
  const codes = new Map<string, string>();
  for (const [iata, icao] of ICAO_BY_IATA) codes.set(icao, iata);
  for (const flight of flights) {
    const { iata, icao } = flight.airline ?? { iata: null, icao: null };
    if (iata !== null && icao !== null) codes.set(icao, iata);
  }
  return codes;
}

/** `AAL100` → `AA 100`; null for a registration, an ATC-only call sign or an unknown airline. */
export function flightOfCallSign(
  callSign: string,
  airlines: ReadonlyMap<string, string>,
): string | null {
  const match = AIRLINE_CALL_SIGN.exec(callSign);
  const iata = match?.[1] === undefined ? undefined : airlines.get(match[1]);
  return iata === undefined || match?.[2] === undefined ? null : `${iata} ${match[2]}`;
}

/** The call sign a flight broadcasts: AeroDataBox's, or its airline's ICAO code and its digits. */
export function callSignOfFlight(flight: ScheduledFlight): string | null {
  if (flight.callSign !== null) return flight.callSign;
  const digits = FLIGHT_NUMBER.exec(flight.number)?.[2];
  const icao = flight.airline?.icao ?? null;
  return digits === undefined || icao === null || !/^[A-Z]{3}$/.test(icao)
    ? null
    : `${icao}${digits}`;
}
