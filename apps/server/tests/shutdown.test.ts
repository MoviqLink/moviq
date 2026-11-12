import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { createShutdown } from '../src/shutdown.js';
import { memoryLogger } from './support/memory-logger.js';

function setup(timeoutMs = 1_000) {
  const emitter = new EventEmitter();
  const exits: number[] = [];
  const log = memoryLogger();
  const shutdown = createShutdown({
    source: emitter,
    exit: (code) => exits.push(code),
    logger: log.logger,
    timeoutMs,
  });
  return { emitter, exits, log, shutdown };
}

describe('createShutdown', () => {
  it('remembers a signal that arrived before anyone waited for it', async () => {
    const { emitter, shutdown } = setup();
    expect(shutdown.requested).toBe(false);
    emitter.emit('SIGTERM', 'SIGTERM');
    expect(shutdown.requested).toBe(true);
    await expect(shutdown.wait()).resolves.toBe('SIGTERM');
  });

  it('forces the exit on a second signal', () => {
    const { emitter, exits, log } = setup();
    emitter.emit('SIGTERM', 'SIGTERM');
    emitter.emit('SIGINT', 'SIGINT');
    expect(exits).toEqual([1]);
    expect(log.entries().map((entry) => entry['msg'])).toEqual(['second signal, forcing exit']);
  });

  it('lets a stop finish within the time limit, and forces the exit when it overruns', async () => {
    const quick = setup(200);
    await quick.shutdown.stopWithin(() => Promise.resolve());
    expect(quick.exits).toEqual([]);
    const slow = setup(20);
    await slow.shutdown.stopWithin(() => new Promise(() => undefined));
    expect(slow.exits).toEqual([1]);
    expect(slow.log.entries().at(-1)).toMatchObject({ msg: 'stop timed out, forcing exit' });
  });

  it('stops listening once disposed', () => {
    const { emitter, shutdown } = setup();
    shutdown.dispose();
    expect(emitter.listenerCount('SIGTERM') + emitter.listenerCount('SIGINT')).toBe(0);
  });
});
