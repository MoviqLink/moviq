import type { LiveSource } from '@moviq/contracts';

/**
 * How old the data of a source is, as the traveller reads it: a static file the provider dates is
 * in force since the day it was published, which is not a delay; anything else is as old as its
 * data, or received that long ago for files the provider does not date.
 */
export type SourceAge =
  | { readonly kind: 'published'; readonly at: string }
  | { readonly kind: 'age'; readonly seconds: number };

/** The age of one source; null while it has no data. */
export function sourceAge(
  source: Pick<LiveSource, 'publishedAt' | 'provenance'>,
): SourceAge | null {
  if (source.publishedAt !== null) return { kind: 'published', at: source.publishedAt };
  const seconds = source.provenance.ageSeconds;
  return seconds === null ? null : { kind: 'age', seconds };
}

/**
 * The age of what comes from several sources: that of the oldest live data, which is what may be
 * late; only when every source with data is a dated file, the oldest publication.
 */
export function oldestAge(sources: readonly LiveSource[]): SourceAge | null {
  const ages = sources.map(sourceAge).filter((age) => age !== null);
  const seconds = ages.flatMap((age) => (age.kind === 'age' ? [age.seconds] : []));
  if (seconds.length > 0) return { kind: 'age', seconds: Math.max(...seconds) };
  const published = ages.flatMap((age) => (age.kind === 'published' ? [age.at] : [])).sort();
  return published[0] === undefined ? null : { kind: 'published', at: published[0] };
}

/** The New York day of a publication, as a date is written: `November 2, 2026`. */
export function publishedDay(instant: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/New_York',
  }).format(new Date(instant));
}
