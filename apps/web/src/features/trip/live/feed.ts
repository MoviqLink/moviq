/** What the screen says about the live connection, with the instants it needs to say since when. */
export type FeedStatus =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'live'; readonly since: number }
  | {
      readonly kind: 'lost';
      /** When the connection dropped; kept while the retries fail, so the age keeps counting. */
      readonly since: number;
      /** When the next automatic attempt starts. */
      readonly retryAt: number;
    };

/** The part of `EventSource` the feed uses, so tests can drive it. */
export interface StreamLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

interface Schema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
}

export interface FeedDeps {
  readonly open: (url: string) => StreamLike;
  readonly now: () => number;
  /** Runs `run` after `ms` and returns what cancels it. */
  readonly setTimer: (run: () => void, ms: number) => () => void;
}

export interface FeedHandlers<T> {
  readonly onData: (data: T) => void;
  readonly onStatus: (status: FeedStatus) => void;
  /** An event that did not match the contract: it is never shown. */
  readonly onRejected: () => void;
}

/** Waits between automatic attempts; the last one repeats. */
export const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000] as const;

function parse(raw: unknown): unknown {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Follows a Server-Sent Events stream of full snapshots. Every drop closes the stream and opens a
 * new one after a growing wait, so the screen always knows whether it is live and since when;
 * `reconnect` opens a new one at once.
 */
export function createLiveFeed<T>(
  url: string,
  schema: Schema<T>,
  deps: FeedDeps,
  handlers: FeedHandlers<T>,
) {
  let stream: StreamLike | null = null;
  let cancelTimer: (() => void) | null = null;
  let failures = 0;
  let lostSince: number | null = null;
  let stopped = false;

  function clear(): void {
    cancelTimer?.();
    cancelTimer = null;
    if (stream !== null) {
      stream.onopen = null;
      stream.onmessage = null;
      stream.onerror = null;
      stream.close();
      stream = null;
    }
  }

  function connect(): void {
    clear();
    if (stopped) return;
    if (lostSince === null) handlers.onStatus({ kind: 'connecting' });
    const current = deps.open(url);
    stream = current;
    current.onopen = () => {
      failures = 0;
      lostSince = null;
      handlers.onStatus({ kind: 'live', since: deps.now() });
    };
    current.onmessage = (event) => {
      const parsed = schema.safeParse(parse(event.data));
      if (parsed.success) handlers.onData(parsed.data);
      else handlers.onRejected();
    };
    current.onerror = () => {
      clear();
      const wait = RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)] ?? 30_000;
      failures += 1;
      lostSince ??= deps.now();
      handlers.onStatus({ kind: 'lost', since: lostSince, retryAt: deps.now() + wait });
      cancelTimer = deps.setTimer(connect, wait);
    };
  }

  return {
    start: connect,
    /** Opens a new connection now, without waiting for the next automatic attempt. */
    reconnect: connect,
    stop(): void {
      stopped = true;
      clear();
    },
  };
}
