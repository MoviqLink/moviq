import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../src/modules/data-platform/definition.js';

const sampleSchema = z.object({ items: z.array(z.number()), at: z.string() });

export type Sample = z.infer<typeof sampleSchema>;

/**
 * A source for tests. Its body is JSON `{ "items": [...], "at": "<instant>" }`; anything else is
 * refused as `bad-json` or `bad-shape`, and fewer items than half of the served copy as
 * `coverage-drop`.
 */
export function testSource(
  overrides: Partial<SourceDefinition<Sample>> = {},
): SourceDefinition<Sample> {
  return {
    id: 'test-feed',
    title: 'Test feed',
    provider: 'Test provider',
    licence: {
      name: 'Test licence',
      url: 'https://example.com/licence',
      attribution: 'Test provider',
    },
    kind: 'realtime',
    rhythm: { class: 'hot', baseIntervalMs: 60_000, interestIntervalMs: 15_000 },
    freshness: { degradedAfterMs: 60_000, staleAfterMs: 300_000, unavailableAfterMs: 3_600_000 },
    limits: { timeoutMs: 1_000, maxBytes: 10_000 },
    keepVersions: 1,
    dataSchema: sampleSchema,
    request: () => ({ url: 'http://127.0.0.1:9/feed' }),
    parse: parseSample,
    check: (data, previous) =>
      previous !== undefined && data.items.length * 2 < previous.items.length
        ? [
            `coverage-drop: ${String(data.items.length)} items, ${String(previous.items.length)} before`,
          ]
        : [],
    consumers: ['trip-watch'],
    failures: [],
    ...overrides,
  };
}

function parseSample(body: Uint8Array): ParseResult<Sample> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return { ok: false, code: 'bad-json', detail: 'The body is not JSON.' };
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('items' in value) ||
    !('at' in value) ||
    !Array.isArray(value.items) ||
    typeof value.at !== 'string'
  ) {
    return { ok: false, code: 'bad-shape', detail: 'Expected items and at.' };
  }
  const items = value.items.filter((item): item is number => typeof item === 'number');
  return {
    ok: true,
    data: { items, at: value.at },
    dataTime: new Date(value.at),
    coverage: `${String(items.length)} items`,
  };
}

/** A source that is never collected in a test, only read: its data comes validated by its schema. */
export function servingSource<T>(id: string, dataSchema: z.ZodType<T>): SourceDefinition<T> {
  return {
    id,
    title: id,
    provider: 'Test provider',
    licence: {
      name: 'Test licence',
      url: 'https://example.com/licence',
      attribution: 'Test provider',
    },
    kind: 'realtime',
    rhythm: { class: 'hot', baseIntervalMs: 60_000 },
    freshness: { degradedAfterMs: 60_000, staleAfterMs: 300_000, unavailableAfterMs: 3_600_000 },
    limits: { timeoutMs: 1_000, maxBytes: 10_000 },
    keepVersions: 1,
    dataSchema,
    request: () => ({ url: `http://127.0.0.1:9/${id}` }),
    parse: () => ({ ok: false, code: 'not-collected', detail: 'This test source is only read.' }),
    consumers: ['trip-watch'],
    failures: [],
  };
}
