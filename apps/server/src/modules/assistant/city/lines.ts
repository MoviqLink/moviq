/**
 * Lines and modes as travellers name them: "the A", "línea 7", "M15", "Bx12 SBS", "PATH",
 * "HOB-WTC", "the ferry". Only names of the networks MovIQ reads are recognised; anything else
 * is not a line, so a word is never taken for one.
 */

/** The modes Sara answers about; `airports` are the FAA programs at JFK, LaGuardia and Newark. */
export const CITY_MODES = ['subway', 'bus', 'rail', 'path', 'ferry', 'airports'] as const;
export type CityMode = (typeof CITY_MODES)[number];

export interface RouteRef {
  readonly mode: 'subway' | 'bus' | 'path';
  /** The route ids of the feeds: `A`; `GS`, `FS` and `H` for the shuttles; `M15+` for SBS. */
  readonly ids: readonly string[];
  /** How Sara writes it: `A`, `S`, `M15-SBS`, `PATH`. */
  readonly label: string;
}

export const PATH_LINES = ['NWK-WTC', 'HOB-WTC', 'JSQ-33', 'HOB-33'] as const;

const SUBWAY = new Set([
  ...['1', '2', '3', '4', '5', '6', '7'],
  ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'J', 'L', 'M', 'N', 'Q', 'R', 'W', 'Z'],
]);
const SHUTTLES = ['GS', 'FS', 'H'];
const BUS = /^(bxm|bm|qm|sim|bx|[mbqsx])(\d{1,3})([a-z]?)(?:\s*(\+|-?\s?sbs|select))?$/i;
const BUS_PREFIX: Readonly<Record<string, string>> = {
  bxm: 'BxM',
  bm: 'BM',
  qm: 'QM',
  sim: 'SIM',
  bx: 'Bx',
  m: 'M',
  b: 'B',
  q: 'Q',
  s: 'S',
  x: 'X',
};
const LEADING = /^(?:the|la|el|line|l[ií]nea|train|tren|bus|autob[uú]s)\s+/i;
const TRAILING = /\s+(?:line|train|trains|l[ií]nea|tren|trenes|bus)$/i;

/** The route named by a short text, or undefined when it names none MovIQ reads. */
export function routeOf(text: string): RouteRef | undefined {
  let words = text.trim().replace(/[.?!¿¡]/g, '');
  for (let pass = 0; pass < 3; pass += 1) words = words.replace(LEADING, '').replace(TRAILING, '');
  const upper = words.toUpperCase();
  if (/^PATH$/.test(upper)) return { mode: 'path', ids: [...PATH_LINES], label: 'PATH' };
  const path = PATH_LINES.find((line) => line === upper.replace(/\s+/g, ''));
  if (path !== undefined) return { mode: 'path', ids: [path], label: path };
  if (SUBWAY.has(upper)) return { mode: 'subway', ids: [upper], label: upper };
  if (upper === 'S' || SHUTTLES.includes(upper)) {
    return { mode: 'subway', ids: upper === 'S' ? SHUTTLES : [upper], label: 'S' };
  }
  if (upper === 'SIR' || upper === 'SI') return { mode: 'subway', ids: ['SI'], label: 'SIR' };
  return busRoute(words);
}

function busRoute(words: string): RouteRef | undefined {
  const match = BUS.exec(words.replace(/\s+(?=\d)/, ''));
  if (match === null) return undefined;
  const [, prefix = '', digits = '', variant = '', sbs] = match;
  const name = `${BUS_PREFIX[prefix.toLowerCase()] ?? prefix}${digits}${variant.toUpperCase()}`;
  const id = name.toUpperCase();
  return sbs === undefined
    ? { mode: 'bus', ids: [id], label: name }
    : { mode: 'bus', ids: [`${id}+`], label: `${name}-SBS` };
}

const MODE_WORDS: readonly (readonly [RegExp, CityMode])[] = [
  [/^(?:the )?(?:subway|metro|underground)$/i, 'subway'],
  [/^(?:the )?(?:bus(?:es)?|autob[uú]s(?:es)?)$/i, 'bus'],
  [
    /^(?:lirr|metro-?north|long island rail ?road|commuter rail|cercan[ií]as|tren(?:es)?)$/i,
    'rail',
  ],
  [/^(?:the )?path$/i, 'path'],
  [/^(?:the )?(?:ferry|ferries|ferri|ferris|ferrys|nyc ferry|ny waterway)$/i, 'ferry'],
  [/^(?:the )?(?:airports?|aeropuertos?|flights|vuelos)$/i, 'airports'],
];

/** The mode named by a short text: "the subway", "el ferri", "LIRR". */
export function modeOf(text: string): CityMode | undefined {
  const words = text
    .trim()
    .replace(/[.?!¿¡]/g, '')
    .replace(/^(?:el|la|los|las)\s+/i, '');
  return MODE_WORDS.find(([pattern]) => pattern.test(words))?.[1];
}

/** "[A][B] trains are delayed" → "A B trains are delayed": the MTA writes routes as symbols. */
export function plainAlertText(text: string, limit = 280): string {
  const words = text
    .replace(/\[([A-Z0-9+]{1,5})\]/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .replace(/ ([.,;:])/g, '$1')
    .trim();
  return words.length <= limit ? words : `${words.slice(0, limit - 1).trimEnd()}…`;
}
