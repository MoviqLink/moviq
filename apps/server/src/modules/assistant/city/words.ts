import type { CityAnswer } from '@moviq/contracts';

import type { Lang } from '../planning/state.js';
import type { Finding, Unanswered } from './findings.js';
import { telling, type Card, type Telling } from './words-common.js';
import { reliabilityCard, stationAccessCard, whereIsCard } from './words-places.js';
import { restroomsCard } from './words-restrooms.js';
import { incidentsCard, lineStatusCard } from './words-status.js';

/** What one city tool gave this turn: a finding, or why it could not answer. */
export type CityResult = Finding | Unanswered;

const isFinding = (result: CityResult): result is Finding =>
  result.kind === 'line-status' ||
  result.kind === 'incidents' ||
  result.kind === 'where-is' ||
  result.kind === 'station-access' ||
  result.kind === 'line-reliability' ||
  result.kind === 'restrooms';

/** At most this many details of each answer are said; the card shows them all. */
const SAID_ITEMS = 3;

function cardOf(finding: Finding, told: Telling): Card {
  switch (finding.kind) {
    case 'line-status':
      return lineStatusCard(finding, told);
    case 'incidents':
      return incidentsCard(finding, told);
    case 'where-is':
      return whereIsCard(finding, told);
    case 'station-access':
      return stationAccessCard(finding, told);
    case 'line-reliability':
      return reliabilityCard(finding, told);
    case 'restrooms':
      return restroomsCard(finding, told);
  }
}

/** The cards of this turn's findings, each with its sources; one without a source is not shown. */
export function cityCards(results: readonly CityResult[], lang: Lang, now: Date): CityAnswer[] {
  const told = telling(lang, now);
  return results.filter(isFinding).flatMap((finding) => {
    const [first, ...rest] = finding.sources;
    if (first === undefined) return [];
    return [{ ...cardOf(finding, told), sources: [first, ...rest] }];
  });
}

/** The fixed words for this turn's city results: each headline and its first details. */
export function citySentences(results: readonly CityResult[], lang: Lang, now: Date): string[] {
  const told = telling(lang, now);
  return results.map((result) => {
    if (!isFinding(result)) return unansweredSentence(result, told);
    const card = cardOf(result, told);
    const items = card.items.slice(0, SAID_ITEMS).map((item) => item.text);
    return [card.headline, ...items].join(' ');
  });
}

function unansweredSentence(result: Unanswered, { say }: Telling): string {
  switch (result.kind) {
    case 'unknown-route':
      return say(
        `I don't know a line called "${result.said}". Tell me a subway line (A, 7…), a bus ` +
          'route (M15, Bx12…) or PATH.',
        `No conozco ninguna línea llamada «${result.said}». Dime una línea de metro (A, 7…), ` +
          'de autobús (M15, Bx12…) o el PATH.',
      );
    case 'unknown-station':
      return say(
        `I can't find a subway station called "${result.said}".`,
        `No encuentro ninguna estación de metro llamada «${result.said}».`,
      );
    case 'stations-unavailable':
      return say(
        `I can't read the list of subway stations right now, so I can't look up "${result.said}".`,
        `Ahora no puedo leer la lista de estaciones de metro, así que no puedo buscar «${result.said}».`,
      );
    case 'unknown-place':
      return say(
        `I can't find a place called "${result.said}" in New York.`,
        `No encuentro ningún lugar llamado «${result.said}» en Nueva York.`,
      );
    case 'places-unavailable':
      return say(
        `I can't search for places right now, so I can't look up "${result.said}".`,
        `Ahora no puedo buscar lugares, así que no puedo buscar «${result.said}».`,
      );
    case 'no-trip':
      return say(
        'You have no trip under watch or planned with me, so I do not know which one you mean.',
        'No tienes ningún viaje en seguimiento ni planificado conmigo, así que no sé a cuál te refieres.',
      );
  }
}
