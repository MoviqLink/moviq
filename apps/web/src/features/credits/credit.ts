import type { CreditsDict } from './texts';

/** A licence as its holder names it, with the page that states it when there is one. */
export interface Licence {
  readonly name: string;
  readonly url: string | null;
}

/**
 * One line of the credits. `attribution` is the credit as the licence asks for it, word for word;
 * `sources` are the ids of the catalogue's sources it covers (none for what is asked on demand or
 * drawn by the map); `basis` are the files of the repository each line is taken from.
 */
export interface Credit {
  readonly id: keyof CreditsDict['credits'];
  readonly attribution: readonly string[];
  readonly licence: Licence;
  readonly sources: readonly string[];
  readonly basis: readonly string[];
}

export interface CreditGroup {
  readonly id: keyof CreditsDict['groups'];
  readonly credits: readonly Credit[];
}

/** The catalogue, generated from the server's source definitions by `npm run docs:sources`. */
export const CATALOGUE = 'docs/data-sources.md';

export const MTA_TERMS: Licence = {
  name: 'MTA Developer Terms and Conditions',
  url: 'https://www.mta.info/developers/terms-and-conditions',
};
export const NYC_TERMS: Licence = {
  name: 'NYC.gov terms of use (NYC Open Data)',
  url: 'https://www.nyc.gov/main/terms-of-use',
};
export const NO_TERMS_GTFS: Licence = {
  name: 'No published terms (public GTFS and GTFS Realtime feeds)',
  url: 'https://www.nywaterway.com/',
};
export const PUBLIC_DOMAIN = 'U.S. Government work, public domain';
export const ODBL: Licence = {
  name: 'Open Database License (ODbL) 1.0',
  url: 'https://opendatacommons.org/licenses/odbl/1.0/',
};

export const numbered = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(2, '0')}`);

export const BOROUGHS = ['bronx', 'brooklyn', 'manhattan', 'queens', 'staten-island'] as const;
export const SUBWAY_LINES = ['1234567', 'ace', 'bdfm', 'g', 'jz', 'l', 'nqrw', 'sir'] as const;
export const NY511 = [
  'cameras',
  'closures',
  'construction',
  'crossing-times',
  'future-construction',
  'incidents',
  'message-signs',
  'road-conditions',
  'special-events',
  'transit-events',
  'weather-warnings',
] as const;
