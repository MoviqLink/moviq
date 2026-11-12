/** The key of a GTFS id within one feed of the network, as GTFS ids are unique only per feed. */
export function feedKey(feed: number, gtfsId: string): string {
  return `${String(feed)}\u0000${gtfsId}`;
}
