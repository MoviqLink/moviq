import type { Flight } from '@moviq/contracts';

import { readFlightNumber, readTerminal } from './flight-number.js';
import { readClock, readDay, readHalf, type ClockReading } from './time-words.js';

export type Airport = Flight['airport'];

/** What one sentence says about a trip. Parts it does not say stay undefined: nothing is guessed. */
export interface Reading {
  readonly flight: { readonly carrier: string; readonly number: string } | undefined;
  readonly day: string | undefined;
  readonly clock: ClockReading | undefined;
  /** "morning", "evening", "pm"…: the answer to "morning or evening?". */
  readonly half: 'am' | 'pm' | undefined;
  readonly origin: string | undefined;
  readonly destination: string | undefined;
  /** The airport named in the sentence, wherever it appears. */
  readonly airport: Airport | undefined;
  /** "terminal 4", "T8": the terminal of a boarding pass. */
  readonly terminal: string | undefined;
  /** Words with no marker before them ("Bryant Park"): a plain answer or a destination. */
  readonly plain: string | undefined;
  /** "the second one", "la segunda", "2": a choice among the places offered. */
  readonly choice: number | undefined;
}

const ORIGIN_MARKERS = [
  'leaving from',
  'starting from',
  'starting at',
  'start from',
  'from',
  "i'm at",
  'i am at',
  "we're at",
  'salgo desde',
  'salgo de',
  'saldré de',
  'saliendo de',
  'parto de',
  'desde',
  'estoy en',
  'estamos en',
];
const DESTINATION_MARKERS = [
  'to be at',
  'to get to',
  'to go to',
  'to arrive at',
  'going to',
  'heading to',
  'get to',
  'go to',
  'take me to',
  'on my way to',
  'be at',
  'to',
  'tengo que llegar al',
  'tengo que llegar a',
  'tengo que estar en',
  'necesito llegar al',
  'necesito llegar a',
  'quiero llegar al',
  'quiero llegar a',
  'quiero ir al',
  'quiero ir a',
  'tengo que ir al',
  'tengo que ir a',
  'llévame al',
  'llévame a',
  'voy al',
  'voy a',
  'vamos al',
  'vamos a',
  'llegar al',
  'llegar a',
  'estar en',
  'ir al',
  'ir a',
  'hacia',
  'hasta',
  'al',
  'a',
];

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternation = (markers: readonly string[]): string => markers.map(escape).join('|');
const ORIGIN = `(${alternation(ORIGIN_MARKERS)})`;
const DESTINATION = `(${alternation(DESTINATION_MARKERS)})`;
const MARKERS = new RegExp(`(?<![\\p{L}\\d])(?:${ORIGIN}|${DESTINATION})(?![\\p{L}\\d])`, 'giu');
/** Words that end a place: what follows is another part of the sentence. */
const STOP_WORDS = [
  'but',
  'pero',
  'para',
  'porque',
  'because',
  'with',
  'con',
  'please',
  'por favor',
];
const STOP_PHRASES = [
  'then',
  'luego',
  'i need',
  'necesito',
  'quiero',
  'i want',
  'tengo que',
  'i have to',
];
const STOP = new RegExp(`[,;.!?¿¡()]|\\b(?:${[...STOP_WORDS, ...STOP_PHRASES].join('|')})\\b`, 'i');
/** Greetings and politeness before a place, which are not part of it. */
const FILLER_WORDS = ['hi', 'hello', 'hey', 'hola', 'buenas', 'ok', 'okay', 'vale', 'please'];
const FILLER_PHRASES = [
  'por favor',
  'thanks',
  'gracias',
  'so',
  'well',
  'bueno',
  'yes',
  'no',
  'sí',
  'si',
];
const FILLER_OPENERS = ['i need', 'necesito', 'quiero', 'i want'];
const FILLER = new RegExp(
  `^(?:(?:${[...FILLER_WORDS, ...FILLER_PHRASES, ...FILLER_OPENERS].join('|')})(?![\\p{L}])[\\s,!.]*)+`,
  'iu',
);
const LEADING_ARTICLE = /^(?:the|my|la|el|los|las|mi)\s+/i;
const PROPER_AIRPORTS: readonly (readonly [RegExp, Airport])[] = [
  [/\b(?:la ?guardia|lga)\b/i, 'LGA'],
  [/\b(?:jfk|kennedy)\b/i, 'JFK'],
  [/\b(?:newark|ewr)\b/i, 'EWR'],
];

/** Reads one sentence in English or Spanish into the parts of a trip. */
export function readSentence(text: string, now: Date): Reading {
  let rest = text.trim();
  const flightNumber = readFlightNumber(rest);
  if (flightNumber) rest = cut(rest, flightNumber.start, flightNumber.end);
  const terminal = readTerminal(rest);
  if (terminal) rest = cut(rest, terminal.start, terminal.end);
  const clock = readClock(rest);
  if (clock) rest = cut(rest, clock.start, clock.end);
  const day = readDay(rest, now);
  if (day) rest = cut(rest, day.start, day.end);
  const places = readPlaces(rest);
  return {
    flight:
      flightNumber === undefined
        ? undefined
        : { carrier: flightNumber.carrier, number: flightNumber.number },
    day: day?.day,
    clock,
    half: clock === undefined ? readHalf(rest) : undefined,
    origin: places.origin,
    destination: places.destination,
    airport: airportIn(text),
    terminal: terminal?.terminal,
    plain: places.plain,
    choice: readChoice(text),
  };
}

export function airportIn(text: string): Airport | undefined {
  return PROPER_AIRPORTS.find(([pattern]) => pattern.test(text))?.[1];
}

function readPlaces(text: string): { origin?: string; destination?: string; plain?: string } {
  const matches = [...text.matchAll(MARKERS)];
  const found: { origin?: string; destination?: string; plain?: string } = {};
  const leading = phrase(text.slice(0, matches[0]?.index ?? text.length));
  if (leading !== undefined) found.plain = leading;
  matches.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const words = phrase(text.slice(start, end));
    if (words === undefined) return;
    if (match[1] !== undefined) found.origin ??= words;
    else found.destination ??= words;
  });
  return found;
}

/** A place as the traveller named it, tidied for the geocoder ("la calle 125" → "125 Street"). */
function phrase(raw: string): string | undefined {
  const stop = STOP.exec(raw);
  const words = (stop ? raw.slice(0, stop.index) : raw)
    .replace(FILLER, '')
    .trim()
    .replace(LEADING_ARTICLE, '')
    .replace(/\bcalle\s+(\d+)\b/gi, '$1 Street')
    .replace(/\bavenida\s+(\d+)\b/gi, '$1 Avenue')
    .replace(/\bquinta avenida\b/gi, '5 Avenue')
    .replace(/\s+/g, ' ')
    .trim();
  return /\p{L}.*\p{L}|\d/u.test(words) && words.length >= 2 ? words : undefined;
}

const ORDINALS: readonly (readonly [RegExp, number])[] = [
  [/^(?:the )?(?:first|1st)(?: one)?$|^(?:el |la )?primer[oa]?(?: opci[oó]n)?$/i, 1],
  [/^(?:the )?(?:second|2nd)(?: one)?$|^(?:el |la )?segund[oa](?: opci[oó]n)?$/i, 2],
  [/^(?:the )?(?:third|3rd)(?: one)?$|^(?:el |la )?tercer[oa]?(?: opci[oó]n)?$/i, 3],
];

function readChoice(text: string): number | undefined {
  const words = text
    .trim()
    .replace(/[.!¡]+$/, '')
    .trim();
  const numbered = /^(?:option|opci[oó]n|number|n[uú]mero|#)?\s*([1-3])$/i.exec(words);
  if (numbered) return Number(numbered[1]);
  return ORDINALS.find(([pattern]) => pattern.test(words))?.[1];
}

function cut(text: string, start: number, end: number): string {
  return `${text.slice(0, start)} ; ${text.slice(end)}`;
}
