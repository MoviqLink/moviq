import type { CityQuestion } from '../city/ask.js';
import { modeOf, PATH_LINES, routeOf, type CityMode, type RouteRef } from '../city/lines.js';

/**
 * Questions about the city as people ask them in English or Spanish: "how is the A?", "¿hay
 * incidencias en el 7?", "where is my bus?", "¿funciona el ascensor de 59 St?", "¿cómo está el
 * PATH?", "¿hay avisos en el ferri?", "¿suele ir bien la línea 7 a esta hora?", "¿hay un baño
 * cerca de Bryant Park?". A sentence that asks none of these is left to the trip planner.
 */
export function readCityQuestion(text: string, now: Date): CityQuestion | undefined {
  const words = text.trim().replace(/^[¿¡\s]+|[?!.\s]+$/g, '');
  return (
    restroomQuestion(words) ??
    accessQuestion(words) ??
    reliabilityQuestion(words, now) ??
    whereQuestion(words) ??
    incidentsQuestion(words) ??
    statusQuestion(words)
  );
}

/** Whole words only, accented letters included: `\\b` ends a word before "á" or "ó". */
const wholeWords = (source: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\d])(?:${source})(?![\\p{L}\\d])`, 'iu');

const ACCESS = wholeWords(
  'elevators?|lifts?|escalators?|step-free|wheelchair|accessible|accessibility|accesib\\p{L}*|' +
    'ascensor(?:es)?|escaleras? mec[aá]nicas?|sin escalones|silla de ruedas',
);
const PLACE = /(?<![\p{L}\d])(?:at|in|of|for|de|del|en)\s+(.+)$/iu;
const PLACE_TAIL =
  /\s+(?:working|work|out|broken|down|today|now|right now|ahora|hoy|funciona|funcionan|va|station|estaci[oó]n)$/iu;
const PLACE_HEAD = /^(?:the|la|el|la estaci[oó]n de|the station|estaci[oó]n de)\s+/iu;
const RELIABILITY = wholeWords(
  'usually|normally|typically|reliable|reliability|on time|suele|suelen|normalmente|fiable|' +
    'fiabilidad|puntual',
);
const WHERE = wholeWords(
  "where(?:'s| is| are)|d[oó]nde (?:est[aá]n?|va|van|anda|andan|viene|vienen)",
);
const MY_RIDE = wholeWords('(?:my|mi)\\s+(?:bus|train|tren|autob[uú]s|metro|ride|subway)');
const FLEET = /(?<![\p{L}\d])(?:bus|autob[uú]s)\s+(?:n[uú]mero\s+|number\s+|#)?(\d{3,5})(?!\d)/iu;
const TOWARDS = /\s(?:to|towards|toward|bound for|hacia|direcci[oó]n|con destino a?)\s+(.+)$/iu;
const INCIDENTS = wholeWords(
  'incidents?|incidencias?|problems?|problemas?|alerts?|avisos?|disruptions?|delays?|' +
    'retrasos?|issues?|obras|cortes?|service changes?|alertas?',
);
const MY_TRIP = wholeWords(
  '(?:my|mi)\\s+(?:trip|journey|route|viaje|ruta|line|l[ií]nea|recorrido)',
);
const SCOPE = /(?<![\p{L}\d])(?:on|in|at|for|with|en|de|del|con)\s+(.+)$/iu;
const STATUS =
  /^(?:how(?:'s| is| are)|c[oó]mo (?:va|van|est[aá]n?|funciona|funcionan|anda|andan))(?![\p{L}\d])(.*)$/iu;
const STATUS_TAIL = /\s+(?:doing|running|going|today|now|right now|ahora|hoy|ahora mismo)$/iu;
const LINE_WORD = /^(?:the|la|el|line|l[ií]nea|train|tren|bus|autob[uú]s)$/iu;

const RESTROOM = wholeWords(
  'restrooms?|bathrooms?|toilets?|washrooms?|lavator(?:y|ies)|aseos?|baños?|lavabos?|váter|wc',
);
const NEAR =
  /(?<![\p{L}\d])(?:near|close to|around|by|at|in|cerca de|junto a|al lado de|en)\s+(.+)$/iu;
const ON_THE_WAY = wholeWords(
  '(?:my|mi)\\s+(?:trip|journey|route|way|viaje|ruta|camino)|on the way|on my way|de camino|' +
    'por el camino|en el camino',
);
const STATION_WORD = /\b(?:station|estaci[oó]n|stop|parada)\b/iu;

/**
 * "Is there a restroom near Bryant Park?", "¿hay un baño en mi camino?", "restroom near 59 St
 * station": a place said after "near" or "cerca de", a station when it says so, else the trip.
 */
function restroomQuestion(words: string): CityQuestion | undefined {
  if (!RESTROOM.test(words)) return undefined;
  if (ON_THE_WAY.test(words)) return { tool: 'restrooms', near: { by: 'trip' } };
  const said = NEAR.exec(words)?.[1];
  const name = said === undefined ? undefined : trimmed(said, PLACE_HEAD, PLACE_TAIL);
  if (name === undefined) return { tool: 'restrooms', near: { by: 'trip' } };
  return STATION_WORD.test(said ?? '')
    ? { tool: 'restrooms', near: { by: 'stop', name: name.replace(STATION_WORD, '').trim() } }
    : { tool: 'restrooms', near: { by: 'place', name } };
}

function accessQuestion(words: string): CityQuestion | undefined {
  const access = ACCESS.exec(words);
  if (access === null) return undefined;
  const place = PLACE.exec(words.slice(access.index + access[0].length))?.[1];
  const station = place === undefined ? undefined : trimmed(place, PLACE_HEAD, PLACE_TAIL);
  return station === undefined ? undefined : { tool: 'station-access', station };
}

function reliabilityQuestion(words: string, now: Date): CityQuestion | undefined {
  if (!RELIABILITY.test(words)) return undefined;
  const route = findRoute(words);
  return route === undefined ? undefined : { tool: 'line-reliability', route, at: now };
}

function whereQuestion(words: string): CityQuestion | undefined {
  if (!WHERE.test(words)) return undefined;
  if (MY_RIDE.test(words)) return { tool: 'where-is', asked: { by: 'trip' } };
  const fleet = FLEET.exec(words)?.[1];
  if (fleet !== undefined) return { tool: 'where-is', asked: { by: 'vehicle', name: fleet } };
  const route = findRoute(words);
  if (route === undefined) return undefined;
  const towards = TOWARDS.exec(words)?.[1]?.trim();
  return { tool: 'where-is', asked: { by: 'route', route, towards: towards ?? null } };
}

function incidentsQuestion(words: string): CityQuestion | undefined {
  if (!INCIDENTS.test(words)) return undefined;
  if (MY_TRIP.test(words)) return { tool: 'incidents', scope: { scope: 'trip' } };
  const phrase = SCOPE.exec(words)?.[1];
  const mode = phrase === undefined ? modeIn(words) : (modeOf(phrase) ?? modeIn(phrase));
  if (mode !== undefined) return { tool: 'incidents', scope: { scope: 'mode', mode } };
  // A line opens the phrase ("en el 7"); one later names the station's line ("59 St on the 4").
  const route = findRoute((phrase ?? words).split(/\s+/).slice(0, 3).join(' '));
  if (route !== undefined) return { tool: 'incidents', scope: { scope: 'line', route } };
  const station = phrase === undefined ? undefined : trimmed(phrase, PLACE_HEAD, PLACE_TAIL);
  return station === undefined
    ? undefined
    : { tool: 'incidents', scope: { scope: 'station', station } };
}

function statusQuestion(words: string): CityQuestion | undefined {
  const rest = STATUS.exec(words)?.[1];
  if (rest === undefined) return undefined;
  const subject = trimmed(rest, /^\s+/, STATUS_TAIL) ?? '';
  const route = findRoute(subject);
  if (route !== undefined) return { tool: 'line-status', route };
  const mode = modeOf(subject);
  return mode === undefined ? undefined : { tool: 'incidents', scope: { scope: 'mode', mode } };
}

/** The words with a head and repeated tails removed, or undefined when nothing is left. */
function trimmed(text: string, head: RegExp, tail: RegExp): string | undefined {
  let words = text.trim().replace(head, '');
  while (tail.test(words)) words = words.replace(tail, '');
  words = words.trim();
  return /\p{L}|\d/u.test(words) && words.length >= 2 ? words : undefined;
}

/**
 * The first line named. A letter or digit alone counts only after "the", "la", "línea"… ("la A",
 * "the 7"), so "a esta hora" or "at 7" are not lines; bus routes and PATH count anywhere.
 */
function findRoute(text: string): RouteRef | undefined {
  const tokens = text.split(/[\s,;:]+/).map((token) => token.replace(/^[¿¡("']+|[?!.)"']+$/g, ''));
  for (const [index, token] of tokens.entries()) {
    const previous = tokens[index - 1] ?? '';
    const next = tokens[index + 1] ?? '';
    if (/^(?:bxm|bm|qm|sim|bx|[mbqsx])\d{1,3}[a-z]?\+?$/i.test(token)) {
      return routeOf(/^(?:sbs|select)$/i.test(next) ? `${token} SBS` : token);
    }
    if (/^path$/i.test(token) || (PATH_LINES as readonly string[]).includes(token.toUpperCase())) {
      return routeOf(token);
    }
    if (/^(?:[1-7a-z]|sir|gs|fs)$/i.test(token) && LINE_WORD.test(previous)) {
      const route = routeOf(token);
      if (route !== undefined) return route;
    }
  }
  return undefined;
}

const MODES_IN: readonly (readonly [RegExp, CityMode])[] = [
  [/\b(?:subway|metro)\b/i, 'subway'],
  [/\b(?:bus|buses|autob[uú]s(?:es)?)\b/i, 'bus'],
  [/\b(?:lirr|metro-?north|cercan[ií]as)\b/i, 'rail'],
  [/\bpath\b/i, 'path'],
  [/\b(?:ferry|ferries|ferri|ferris)\b/i, 'ferry'],
  [/\b(?:airports?|aeropuertos?)\b/i, 'airports'],
];

function modeIn(text: string): CityMode | undefined {
  return MODES_IN.find(([pattern]) => pattern.test(text))?.[1];
}
