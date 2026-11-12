import {
  createLogger,
  type Logger,
  type LogLevel,
} from '../../src/infrastructure/telemetry/logger.js';
import type { ManualClock } from './manual-clock.js';

export interface MemoryLogger {
  readonly logger: Logger;
  /** Every line written so far, parsed back from JSON. */
  readonly entries: () => readonly Readonly<Record<string, unknown>>[];
  /** The raw text written so far, to check that nothing sensitive leaked. */
  readonly text: () => string;
}

export function memoryLogger(level: LogLevel = 'debug', clock?: ManualClock): MemoryLogger {
  const lines: string[] = [];
  const logger = createLogger({
    level,
    sink: (line) => lines.push(line),
    ...(clock === undefined ? {} : { clock }),
  });
  return {
    logger,
    entries: () => lines.map((line) => JSON.parse(line) as Readonly<Record<string, unknown>>),
    text: () => lines.join('\n'),
  };
}
