import type { Logger } from './infrastructure/telemetry/logger.js';

type SignalName = 'SIGTERM' | 'SIGINT';

/** The part of `process` the coordinator needs, so tests can drive it without real signals. */
interface SignalSource {
  on(event: SignalName, listener: (signal: NodeJS.Signals) => void): unknown;
  off(event: SignalName, listener: (signal: NodeJS.Signals) => void): unknown;
}

export interface ShutdownOptions {
  readonly source: SignalSource;
  readonly exit: (code: number) => void;
  readonly logger: Logger;
  /** How long stopping may take before the process is forced to exit. */
  readonly timeoutMs: number;
}

export interface Shutdown {
  /** True once SIGTERM or SIGINT arrived, even during start-up. */
  readonly requested: boolean;
  /** Resolves with the first signal; at once if it already arrived. */
  wait(): Promise<NodeJS.Signals>;
  /** Runs `stop` within the time limit. A stop that overruns forces exit code 1. */
  stopWithin(stop: () => Promise<void>): Promise<void>;
  dispose(): void;
}

const SIGNALS: readonly SignalName[] = ['SIGTERM', 'SIGINT'];

/**
 * Listens for SIGTERM and SIGINT from the very start of a process. The first signal asks for a
 * clean stop; a second one, or a stop that overruns its time limit, forces the exit.
 */
export function createShutdown(options: ShutdownOptions): Shutdown {
  let received: NodeJS.Signals | undefined;
  let resolveFirst: (signal: NodeJS.Signals) => void = () => undefined;
  const first = new Promise<NodeJS.Signals>((resolve) => {
    resolveFirst = resolve;
  });
  const onSignal = (signal: NodeJS.Signals) => {
    if (received !== undefined) {
      options.logger.error('second signal, forcing exit', { signal });
      options.exit(1);
      return;
    }
    received = signal;
    resolveFirst(signal);
  };
  for (const name of SIGNALS) options.source.on(name, onSignal);

  return {
    get requested() {
      return received !== undefined;
    },
    wait: () => first,
    stopWithin: async (stop) => {
      let timer: NodeJS.Timeout | undefined;
      const overrun = new Promise<'overrun'>((resolve) => {
        timer = setTimeout(() => {
          resolve('overrun');
        }, options.timeoutMs);
      });
      const outcome = await Promise.race([stop().then(() => 'stopped' as const), overrun]);
      clearTimeout(timer);
      if (outcome === 'overrun') {
        options.logger.error('stop timed out, forcing exit', { timeoutMs: options.timeoutMs });
        options.exit(1);
      }
    },
    dispose: () => {
      for (const name of SIGNALS) options.source.off(name, onSignal);
    },
  };
}
