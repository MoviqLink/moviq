import { describe, expect, it } from 'vitest';

import { Secret } from '../src/config/secret.js';
import { createLogger } from '../src/infrastructure/telemetry/logger.js';
import { manualClock } from './support/manual-clock.js';
import { memoryLogger } from './support/memory-logger.js';

describe('createLogger', () => {
  it('writes one JSON object per line with the time, level, message and fields', () => {
    const { logger, entries } = memoryLogger('debug', manualClock('2026-11-11T08:00:00.000Z'));
    logger.info('ready', { port: 8080 });
    expect(entries()).toEqual([
      { time: '2026-11-11T08:00:00.000Z', level: 'info', msg: 'ready', port: 8080 },
    ]);
  });

  it('drops entries below its level', () => {
    const { logger, entries } = memoryLogger('warn');
    logger.debug('hidden');
    logger.info('hidden');
    logger.warn('shown');
    logger.error('shown');
    expect(entries().map((entry) => entry['level'])).toEqual(['warn', 'error']);
  });

  it('carries the bindings of child loggers', () => {
    const { logger, entries } = memoryLogger();
    logger.child({ process: 'api' }).child({ requestId: 'r-1' }).info('request');
    expect(entries()[0]).toMatchObject({ process: 'api', requestId: 'r-1' });
  });

  it('never writes secrets, even nested or under innocent keys', () => {
    const { logger, text } = memoryLogger();
    logger.info('call', {
      headers: { authorization: 'Bearer abc123', cookie: 'sid=xyz' },
      config: { apiKey: 'k-1', api_key: 'k-2', clientSecret: 's-1', password: 'p-1' },
      value: new Secret('hidden-value'),
    });
    for (const leaked of ['abc123', 'sid=xyz', 'k-1', 'k-2', 's-1', 'p-1', 'hidden-value']) {
      expect(text()).not.toContain(leaked);
    }
    expect(text()).toContain('[redacted]');
  });

  it('expands errors with their code and cause, and survives cycles and bigints', () => {
    const { logger, entries } = memoryLogger();
    const error = Object.assign(new Error('boom', { cause: new Error('root') }), {
      code: 'E_TEST',
    });
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic['self'] = cyclic;
    logger.error('failed', { error, cyclic, big: 10n });
    const entry = entries()[0];
    expect(entry?.['error']).toMatchObject({
      name: 'Error',
      message: 'boom',
      code: 'E_TEST',
      cause: { message: 'root' },
    });
    expect(entry?.['cyclic']).toEqual({ name: 'loop', self: '[circular]' });
    expect(entry?.['big']).toBe('10');
  });

  it('keeps operational fields whose names only look sensitive (regression)', () => {
    const { logger, entries } = memoryLogger();
    logger.info('lease acquired', {
      fencingToken: 3,
      tokens: 120,
      inputTokens: 80,
      adminToken: 'x',
    });
    expect(entries()[0]).toMatchObject({
      fencingToken: 3,
      tokens: 120,
      inputTokens: 80,
      adminToken: '[redacted]',
    });
  });
});

describe('secrets inside errors and messages (regression)', () => {
  const KNOWN = 'known-secret-value-1234';

  it('removes known secret values from messages, stacks and causes', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'debug',
      sink: (line) => lines.push(line),
      secrets: [new Secret(KNOWN)],
    });
    const error = new Error(`login failed with ${KNOWN}`, { cause: new Error(`retry ${KNOWN}`) });
    logger.error(`could not use ${KNOWN}`, { error, note: `value ${KNOWN}` });
    const text = lines.join('\n');
    expect(text).not.toContain(KNOWN);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      msg: 'could not use [redacted]',
      error: { message: 'login failed with [redacted]', cause: { message: 'retry [redacted]' } },
    });
  });

  it('removes credentials with a recognisable shape even when they are not known', () => {
    const { logger, text } = memoryLogger();
    const openaiKey = `sk-${'b'.repeat(30)}`;
    logger.error('upstream failed', {
      error: new Error(
        `GET https://user:pa55word@api.example.com/v1?api_key=abc123&city=nyc&access_token=t0k ` +
          `with Authorization: Bearer eyJhbGciOi.payload.sig and ${openaiKey}`,
      ),
    });
    for (const leaked of ['pa55word', 'abc123', 't0k', 'eyJhbGciOi', openaiKey]) {
      expect(text()).not.toContain(leaked);
    }
    expect(text()).toContain('city=nyc');
    expect(text()).toContain('api.example.com');
  });

  it('ignores known values too short to be credentials, so logs stay readable', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      sink: (line) => lines.push(line),
      secrets: [new Secret('ab')],
    });
    logger.info('about tables');
    expect(lines[0]).toContain('about tables');
  });
});

describe('faithful logs (regression)', () => {
  it('leaves ordinary words alone and still hides authorization values', () => {
    const { logger, text } = memoryLogger();
    logger.info('Basic checks passed, Bearer of good news');
    logger.info('upstream', {
      detail: 'sent Authorization: Basic dXNlcjpwYXNzd29yZA== to the API',
    });
    expect(text()).toContain('Basic checks passed, Bearer of good news');
    expect(text()).not.toContain('dXNlcjpwYXNzd29yZA');
  });

  it('writes an object that appears twice in full, and marks only real cycles', () => {
    const { logger, entries } = memoryLogger();
    const shared = { stop: 'M60' };
    const looped: Record<string, unknown> = {};
    looped['again'] = looped;
    const selfCaused = new Error('loop');
    Object.assign(selfCaused, { cause: selfCaused });
    logger.info('x', { a: shared, b: shared, looped, error: selfCaused });
    expect(entries()[0]).toMatchObject({
      a: { stop: 'M60' },
      b: { stop: 'M60' },
      looped: { again: '[circular]' },
      error: { message: 'loop', cause: '[circular]' },
    });
  });

  it('never lets fields replace the time, level or message', () => {
    const { logger, entries } = memoryLogger('debug', manualClock('2026-11-11T08:00:00.000Z'));
    logger.error('real message', { level: 'info', msg: 'fake', time: 'yesterday' });
    expect(entries()[0]).toMatchObject({
      time: '2026-11-11T08:00:00.000Z',
      level: 'error',
      msg: 'real message',
      'field.level': 'info',
      'field.msg': 'fake',
      'field.time': 'yesterday',
    });
  });

  it('keeps fencing tokens visible in any spelling', () => {
    const { logger, entries } = memoryLogger();
    logger.info('beat', { fencing_token: 2, FENCING_TOKEN: 3 });
    expect(entries()[0]).toMatchObject({ fencing_token: 2, FENCING_TOKEN: 3 });
  });
});
