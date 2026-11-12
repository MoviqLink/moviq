import type { MovIqEvent } from '@moviq/contracts';

import { distanceMeters } from '../live/geo.js';
import type { Listing } from './families.js';

/** Two venues this close are one: the same building as two providers place it. */
const SAME_VENUE_METERS = 100;

const sameStart = (a: Listing, b: Listing): boolean =>
  Date.parse(a.event.startsAt) === Date.parse(b.event.startsAt);

const sameVenue = (a: Listing, b: Listing): boolean =>
  distanceMeters(a.event.venue, b.event.venue) <= SAME_VENUE_METERS;

/** One listing per event of each family: windows of a provider overlap; the newest copy stays. */
function onePerEvent(listings: readonly Listing[]): Listing[] {
  const kept = new Map<string, Listing>();
  for (const listing of listings) {
    const key = `${listing.familyId}:${listing.event.id}`;
    const held = kept.get(key);
    if (held === undefined || Date.parse(listing.dataTime) > Date.parse(held.dataTime)) {
      kept.set(key, listing);
    }
  }
  return [...kept.values()];
}

/** The listings of `other` family that match `listing` by the rule. */
function matchesIn(listing: Listing, other: readonly Listing[]): Listing[] {
  return other.filter(
    (candidate) => sameStart(listing, candidate) && sameVenue(listing, candidate),
  );
}

function groupsOf(listings: readonly Listing[], families: readonly string[]): Listing[][] {
  const byFamily = new Map(families.map((id) => [id, listings.filter((l) => l.familyId === id)]));
  const parent = new Map<Listing, Listing>(listings.map((listing) => [listing, listing]));
  const root = (listing: Listing): Listing => {
    let current = listing;
    let next = parent.get(current);
    while (next !== undefined && next !== current) {
      current = next;
      next = parent.get(current);
    }
    return current;
  };
  for (const listing of listings) {
    for (const [familyId, members] of byFamily) {
      if (familyId === listing.familyId) continue;
      const [only, ...more] = matchesIn(listing, members);
      // One-to-one only: an event matching two of another family is not merged with either.
      if (only === undefined || more.length > 0) continue;
      const back = matchesIn(only, byFamily.get(listing.familyId) ?? []);
      if (back.length === 1) parent.set(root(only), root(listing));
    }
  }
  const groups = new Map<Listing, Listing[]>();
  for (const listing of listings) {
    const top = root(listing);
    groups.set(top, [...(groups.get(top) ?? []), listing]);
  }
  // A chain through several families can bring two of one family together: then nothing merges.
  return [...groups.values()].flatMap((group) =>
    new Set(group.map((l) => l.familyId)).size === group.length ? [group] : group.map((l) => [l]),
  );
}

function eventOf(group: readonly Listing[], families: readonly string[]): MovIqEvent | undefined {
  const ordered = [...group].sort(
    (a, b) => families.indexOf(a.familyId) - families.indexOf(b.familyId),
  );
  const [first] = ordered;
  if (first === undefined) return undefined;
  const { event } = first;
  return {
    id: `${first.familyId}:${event.id}`,
    name: event.name,
    category:
      event.category === 'other'
        ? (ordered.find((l) => l.event.category !== 'other')?.event.category ?? 'other')
        : event.category,
    status: event.status,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    venue: event.venue,
    listings: ordered.map((listing) => ({
      sourceId: listing.sourceId,
      eventId: listing.event.id,
      officialUrl: listing.event.officialUrl,
      dataTime: listing.dataTime,
    })),
  };
}

/**
 * The events of every family, each once. Two listings of different families are one event only
 * when they start at the same instant at the same venue (within 100 m), and each is the other's
 * only match: never by a similar name. The first family in `families` gives the words and link.
 */
export function mergeListings(
  listings: readonly Listing[],
  families: readonly string[],
): MovIqEvent[] {
  return groupsOf(onePerEvent(listings), families)
    .map((group) => eventOf(group, families))
    .filter((event): event is MovIqEvent => event !== undefined)
    .sort(
      (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.name.localeCompare(b.name),
    );
}
