/**
 * Transitous names stops and routes `<feed>_<GTFS id>`, where the feed is the dataset's name in
 * Transitous, such as `us-ny-MTA-NYCSubway_A41N` or `us-ny-MTA-BusBrooklyn_B57` (feed names from
 * `feeds/us-ny.json` in the Transitous repository). Feed names have no underscore.
 */
const TRANSITOUS_ID = /^([a-z]{2}-[a-z0-9]+-[A-Za-z0-9-]+)_(.+)$/;

/** The feed and the GTFS id of a Transitous stop or route id, or `undefined` in another form. */
export function splitTransitousId(
  id: string,
): { readonly feed: string; readonly gtfsId: string } | undefined {
  const match = TRANSITOUS_ID.exec(id);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return { feed: match[1], gtfsId: match[2] };
}
