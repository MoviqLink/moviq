import { ICAO_BY_IATA } from '../../journeys/flight-callsign.js';

/**
 * Flight numbers as people write them: "AA1234", "aa 1234", "AA-1234", "DL 405", "B6 123",
 * "American 1234", "vuelo DL 405", "flight ba117". Without the word "flight" or "vuelo", only
 * the codes of airlines that fly from New York count, so bus routes ("M60", "Bx12") and times
 * ("at 7") are never read as flights.
 */

interface FlightNumberReading {
  /** IATA code, upper case. */
  readonly carrier: string;
  /** Digits without leading zeros. */
  readonly number: string;
  readonly start: number;
  readonly end: number;
}

/** Airlines with departures from JFK, LaGuardia or Newark. */
const NEW_YORK_CARRIERS: ReadonlySet<string> = new Set([
  'AA',
  'DL',
  'UA',
  'B6',
  'WN',
  'NK',
  'F9',
  'AS',
  'G4',
  'SY',
  'HA',
  'MX',
  'AC',
  'BA',
  'VS',
  'AF',
  'KL',
  'LH',
  'IB',
  'UX',
  'TP',
  'AZ',
  'TK',
  'EK',
  'QR',
  'EI',
  'LX',
  'AM',
  'AV',
  'CM',
  'LA',
  'SK',
  'AY',
  'OS',
  'SN',
  'LO',
]);

/** Two-letter words that are also airline codes: in lower case they are words, not flights. */
const WORDS: ReadonlySet<string> = new Set(['am', 'as', 'la', 'lo', 'os', 'ux', 'ay', 'sy']);

/** IATA code by ICAO code: a call sign such as "AAL 100" names a flight too. */
const ICAO: ReadonlyMap<string, string> = new Map(
  [...ICAO_BY_IATA].map(([iata, icao]) => [icao, iata]),
);

const NAMES: readonly (readonly [RegExp, string])[] = [
  [/american(?: airlines)?/, 'AA'],
  [/delta(?: air ?lines)?/, 'DL'],
  [/united(?: airlines)?/, 'UA'],
  [/jet ?blue(?: airways)?/, 'B6'],
  [/southwest(?: airlines)?/, 'WN'],
  [/spirit(?: airlines)?/, 'NK'],
  [/frontier(?: airlines)?/, 'F9'],
  [/alaska(?: airlines)?/, 'AS'],
  [/air canada/, 'AC'],
  [/british airways/, 'BA'],
  [/virgin atlantic/, 'VS'],
  [/air france/, 'AF'],
  [/lufthansa/, 'LH'],
  [/iberia/, 'IB'],
  [/aer lingus/, 'EI'],
  [/aerom[eé]xico/, 'AM'],
];

const KEYWORD =
  /\b(?:flight|vuelo|flt)\s+(?:n(?:o|º|°|úmero|umero)\.?\s*)?([a-z0-9]{2,3}?)[\s-]?(\d{1,4})\b/i;
const NAMED = new RegExp(
  `\\b(${NAMES.map(([pattern]) => pattern.source).join('|')})\\s+(?:flight\\s+|vuelo\\s+)?(\\d{1,4})\\b`,
  'i',
);
/** What may follow a number that is a time or a street, not a flight. */
const NOT_A_FLIGHT = [
  'a\\.?m\\b',
  'p\\.?m\\b',
  'h\\b',
  'st\\b',
  'nd\\b',
  'rd\\b',
  'th\\b',
  'street',
  'calle',
  'av\\b',
  'ave\\b',
  'avenue',
];
const BARE = new RegExp(
  `\\b([a-z][a-z0-9]|[0-9][a-z])[\\s-]?(\\d{1,4})\\b(?![:.]\\d|\\s*(?:${NOT_A_FLIGHT.join('|')}))`,
  'gi',
);
const ICAO_PATTERN = new RegExp(`\\b(${[...ICAO.keys()].join('|')})\\s?-?(\\d{1,4})\\b`);

export function readFlightNumber(text: string): FlightNumberReading | undefined {
  return byKeyword(text) ?? byName(text) ?? byIcao(text) ?? byCode(text);
}

/**
 * "terminal 4", "Terminal B", "T8": the terminal printed on a boarding pass. Letters count in
 * capitals only, so "la terminal a las 6" is not terminal A.
 */
const TERMINAL = /\b[Tt]erminal\s+([A-Z]|\d{1,2}[A-Z]?)\b|\bT([1-9]\d?|[A-C])\b/;

export function readTerminal(
  text: string,
): { readonly terminal: string; readonly start: number; readonly end: number } | undefined {
  const match = TERMINAL.exec(text);
  const terminal = match?.[1] ?? match?.[2];
  if (match === null || terminal === undefined) return undefined;
  return {
    terminal: terminal.toUpperCase(),
    start: match.index,
    end: match.index + match[0].length,
  };
}

/** "AA 1234": how Sara writes a flight. */
export function flightLabel(carrier: string, number: string): string {
  return `${carrier} ${number}`;
}

function byKeyword(text: string): FlightNumberReading | undefined {
  const match = KEYWORD.exec(text);
  const code = match?.[1]?.toUpperCase() ?? '';
  if (!match || !/[A-Z]/.test(code)) return undefined;
  return reading(ICAO.get(code) ?? code, match[2] ?? '', match);
}

function byName(text: string): FlightNumberReading | undefined {
  const match = NAMED.exec(text);
  if (!match) return undefined;
  const name = (match[1] ?? '').toLowerCase();
  const carrier = NAMES.find(([pattern]) => new RegExp(`^${pattern.source}$`).test(name))?.[1];
  return carrier === undefined ? undefined : reading(carrier, match[2] ?? '', match);
}

function byIcao(text: string): FlightNumberReading | undefined {
  const match = ICAO_PATTERN.exec(text);
  const carrier = ICAO.get(match?.[1] ?? '');
  return match && carrier !== undefined ? reading(carrier, match[2] ?? '', match) : undefined;
}

function byCode(text: string): FlightNumberReading | undefined {
  for (const match of text.matchAll(BARE)) {
    const written = match[1] ?? '';
    const code = written.toUpperCase();
    if (!NEW_YORK_CARRIERS.has(code)) continue;
    if (written === written.toLowerCase() && WORDS.has(written)) continue;
    return reading(code, match[2] ?? '', match);
  }
  return undefined;
}

function reading(carrier: string, digits: string, match: RegExpMatchArray): FlightNumberReading {
  const start = match.index ?? 0;
  return { carrier, number: String(Number(digits)), start, end: start + match[0].length };
}
