import { SNAPSHOT_MS, type LiveCity } from './city.js';

interface WarmCity {
  /** Stops building; a build in flight ends without scheduling another. */
  stop(): void;
}

/**
 * Builds the city every 5 seconds whether anyone looks or not, so the estimator follows every
 * vehicle from start-up: a train seen to leave its station is drawn between stations when a
 * screen opens, instead of at the station for its first minutes. A screen asking in between gets
 * the same snapshot, so the sources are read no more often than with one screen open.
 *
 * One build at a time: the next starts 5 seconds after the last one started, or as soon as it
 * ends when it took longer. Timers do not keep the process alive.
 */
export function keepCityWarm(
  city: Pick<LiveCity, 'snapshot'>,
  onError: (error: unknown) => void,
  everyMs: number = SNAPSHOT_MS,
): WarmCity {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const build = () => {
    const startedAt = performance.now();
    city
      .snapshot()
      .catch(onError)
      .finally(() => {
        if (stopped) return;
        const wait = Math.max(0, everyMs - (performance.now() - startedAt));
        timer = setTimeout(build, wait);
        timer.unref();
      });
  };
  build();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
