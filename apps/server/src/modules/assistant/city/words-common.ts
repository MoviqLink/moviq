import type { CityAnswer } from '@moviq/contracts';

import type { Lang } from '../planning/state.js';
import { day, time, type Words } from '../planning/words.js';
import type { CityMode, RouteRef } from './lines.js';

export type Card = Omit<CityAnswer, 'sources'>;
export type Item = CityAnswer['items'][number];

/** How a card is told: the traveller's language, its words and the time now in New York. */
export interface Telling {
  readonly lang: Lang;
  readonly say: Words;
  readonly now: Date;
}

export function telling(lang: Lang, now: Date): Telling {
  return { lang, now, say: (en, es) => (lang === 'es' ? es : en) };
}

/** "7:42 pm" today, "7:42 pm tomorrow" or with its date, in New York time. */
export const when = (instant: string, told: Telling): string =>
  `${time(new Date(instant), told.lang)}${day(new Date(instant), told.lang, told.now)}`;

export const minutes = (seconds: number): string => String(Math.max(1, Math.round(seconds / 60)));

export const capital = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** "the A", "la A", "el M15", "PATH". */
export function routeName(route: RouteRef, say: Words): string {
  if (route.mode === 'path') return route.label === 'PATH' ? say('PATH', 'el PATH') : route.label;
  return route.mode === 'bus'
    ? say(`the ${route.label}`, `el ${route.label}`)
    : say(`the ${route.label}`, `la ${route.label}`);
}

const MODE_NAMES: Readonly<Record<CityMode, readonly [en: string, es: string]>> = {
  subway: ['the subway', 'el metro'],
  bus: ['the buses', 'los autobuses'],
  rail: ['the LIRR and Metro-North', 'el LIRR y el Metro-North'],
  path: ['PATH', 'el PATH'],
  ferry: ['the ferries', 'los ferris'],
  airports: ['JFK, LaGuardia and Newark', 'JFK, LaGuardia y Newark'],
};

export const modeName = (mode: CityMode, say: Words): string => say(...MODE_NAMES[mode]);
