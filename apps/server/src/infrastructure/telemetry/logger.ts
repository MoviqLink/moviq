import { toInstant } from '@moviq/contracts';

import { Secret } from '../../config/secret.js';
import { systemClock, type Clock } from '../clock/clock.js';
import { createTextSanitizer, REDACTED } from './sanitize.js';

export const logLevels = ['debug', 'info', 'warn', 'error'] as const;

export type LogLevel = (typeof logLevels)[number];

type LogFields = Readonly<Record<string, unknown>>;

/** Structured logs, one JSON object per line. Secrets never reach the output. */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

type LogSink = (line: string) => void;

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly sink?: LogSink;
  readonly clock?: Clock;
  readonly bindings?: LogFields;
  /** Credentials in use. Their values are removed from every text the logger writes. */
  readonly secrets?: readonly Secret[];
}

const RESERVED = new Set(['time', 'level', 'msg']);
const MAX_DEPTH = 12;

/** Field names whose value is never written, whatever it holds. */
const SENSITIVE_WORDS: ReadonlySet<string> = new Set([
  'secret',
  'secrets',
  'password',
  'passwd',
  'passphrase',
  'authorization',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'signature',
]);

/** Names that end in "token" but hold no secret: a lease's fencing token is a counter. */
const SAFE_NAMES: ReadonlySet<string> = new Set(['fencing token']);

export function createLogger(options: LoggerOptions): Logger {
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const clock = options.clock ?? systemClock;
  const threshold = logLevels.indexOf(options.level);
  const bindings = options.bindings ?? {};
  const sanitize = createTextSanitizer(options.secrets ?? []);

  const write = (level: LogLevel, message: string, fields: LogFields = {}) => {
    if (logLevels.indexOf(level) < threshold) return;
    const entry: Record<string, unknown> = {
      time: toInstant(clock.now()),
      level,
      msg: sanitize(message),
    };
    for (const [key, value] of Object.entries({ ...bindings, ...fields })) {
      entry[RESERVED.has(key) ? `field.${key}` : key] = toSafe(key, value, sanitize, [], 0);
    }
    sink(JSON.stringify(entry));
  };

  return {
    debug: (message, fields) => {
      write('debug', message, fields);
    },
    info: (message, fields) => {
      write('info', message, fields);
    },
    warn: (message, fields) => {
      write('warn', message, fields);
    },
    error: (message, fields) => {
      write('error', message, fields);
    },
    child: (extra) =>
      createLogger({ ...options, sink, clock, bindings: { ...bindings, ...extra } }),
  };
}

/**
 * Copies a value into plain JSON data: sensitive keys and secret texts redacted, errors
 * expanded, bigints as text. Only an object that contains itself is marked as circular.
 */
function toSafe(
  key: string,
  value: unknown,
  sanitize: (text: string) => string,
  ancestors: readonly object[],
  depth: number,
): unknown {
  if (key !== '' && isSensitiveKey(key)) return REDACTED;
  if (typeof value === 'string') return sanitize(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object' || value === null) {
    return typeof value === 'function' || typeof value === 'symbol' ? undefined : value;
  }
  if (value instanceof Secret) return REDACTED;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : toInstant(value);
  if (ancestors.includes(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[too deep]';
  const path = [...ancestors, value];
  const source: object = value instanceof Error ? describeError(value) : value;
  if (Array.isArray(source)) {
    return source.map((item: unknown) => toSafe('', item, sanitize, path, depth + 1) ?? null);
  }
  const copy: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(source)) {
    const safe = toSafe(childKey, child, sanitize, path, depth + 1);
    if (safe !== undefined) copy[childKey] = safe;
  }
  return copy;
}

function isSensitiveKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
  if (SAFE_NAMES.has(words.join(' '))) return false;
  const last = words.at(-1);
  return (
    words.some((word) => SENSITIVE_WORDS.has(word)) ||
    last === 'token' ||
    last === 'key' ||
    last === 'apikey'
  );
}

function describeError(error: Error): Readonly<Record<string, unknown>> {
  const code = (error as { code?: unknown }).code;
  return {
    name: error.name,
    message: error.message,
    ...(typeof code === 'string' ? { code } : {}),
    ...(error.stack === undefined ? {} : { stack: error.stack }),
    ...(error.cause === undefined ? {} : { cause: error.cause }),
  };
}
