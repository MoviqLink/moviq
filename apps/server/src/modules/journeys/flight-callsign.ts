import type { Flight } from '@moviq/contracts';

/**
 * The ICAO codes of airlines flying from New York, by IATA code: an aircraft broadcasts its ICAO
 * call sign (`AAL100` for AA 100), which is how ADS-B finds it.
 */
export const ICAO_BY_IATA: ReadonlyMap<string, string> = new Map([
  ['AA', 'AAL'],
  ['DL', 'DAL'],
  ['UA', 'UAL'],
  ['B6', 'JBU'],
  ['WN', 'SWA'],
  ['NK', 'NKS'],
  ['F9', 'FFT'],
  ['AS', 'ASA'],
  ['BA', 'BAW'],
  ['AF', 'AFR'],
  ['LH', 'DLH'],
  ['IB', 'IBE'],
]);

/** The call sign AeroDataBox gave, or the one the airline's ICAO code makes; null without either. */
export function callSignOf(flight: Flight): string | null {
  if (flight.callSign !== null) return flight.callSign;
  const icao = ICAO_BY_IATA.get(flight.carrier);
  return icao === undefined ? null : `${icao}${flight.number}`;
}
