import type { Clock } from '../../../infrastructure/clock/clock.js';
import type { SourceReader } from '../../data-platform/reader.js';
import { subwaySources } from '../../data-platform/sources/mta/subway-realtime.js';

/** A route asked for that no feed listed is looked for again, at most this often. */
const LOOK_AGAIN_MS = 60_000;

/**
 * The feed each subway route runs in, as the eight feeds list their trips: the recorder keeps the
 * error of the predictions by feed, and the estimator asks for it by route. Read with every
 * renewal; a route asked for that no feed listed then is looked for again in the background.
 */
export function createSubwayRoutes(
  reader: SourceReader,
  clock: Clock,
  onError: (error: unknown) => void,
) {
  const feeds = new Map<string, string>();
  let readAt = Number.NEGATIVE_INFINITY;
  let reading: Promise<void> | undefined;

  async function read(): Promise<void> {
    readAt = clock.now().getTime();
    for (const definition of subwaySources) {
      const served = await reader.read(definition);
      for (const trip of served.data?.trips ?? []) feeds.set(trip.routeId, definition.id);
    }
  }

  return {
    read,
    feedOf(route: string): string | undefined {
      const feed = feeds.get(route);
      const due = clock.now().getTime() - readAt >= LOOK_AGAIN_MS;
      if (feed === undefined && due && reading === undefined) {
        reading = read()
          .catch(onError)
          .finally(() => {
            reading = undefined;
          });
      }
      return feed;
    },
    /** Resolves once no look is in flight. */
    settled: (): Promise<void> => reading ?? Promise.resolve(),
  };
}
