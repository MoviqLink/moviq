import { describe, expect, it } from 'vitest';

import { resolveIntegrations } from '../../src/config/integrations.js';
import { createHttpClient } from '../../src/infrastructure/http/client.js';
import { attemptCollection } from '../../src/modules/data-platform/attempt.js';
import { credentialsFrom } from '../../src/modules/data-platform/credentials.js';
import {
  eventListSchema,
  eventSources,
  ticketmasterSources,
} from '../../src/modules/data-platform/sources/events/index.js';

const http = createHttpClient();
const credentials = credentialsFrom(resolveIntegrations(process.env));

/**
 * The first window of Ticketmaster (with `TICKETMASTER_API_KEY`), NYC Parks and the two venue
 * pages, one real request each, through the whole admission chain. Run with `npm run verify:live`.
 */
const sources = [
  ...ticketmasterSources.slice(0, 1),
  ...eventSources.filter((definition) => !definition.id.startsWith('ticketmaster-')),
];

describe('the event sources against their real providers', () => {
  it.each(sources.map((definition) => [definition.id, definition] as const))(
    '%s is admitted, every event with its official page',
    async (_, definition) => {
      const { missing, values } = credentials.resolve(definition);
      expect(missing, `set ${missing.join(', ')} to validate this integration`).toEqual([]);
      const attempt = await attemptCollection({
        definition,
        current: undefined,
        previous: undefined,
        credentials: values,
        http,
        now: () => new Date(),
      });
      if (attempt.outcome !== 'admitted') {
        const why =
          attempt.outcome === 'unchanged' ? '' : `${attempt.errorCode}: ${attempt.detail}`;
        throw new Error(`${definition.id} ${attempt.outcome} ${why}`);
      }
      const list = eventListSchema.parse(attempt.data);
      expect(list.events.length).toBeGreaterThan(0);
      for (const event of list.events) expect(event.officialUrl).toMatch(/^https?:\/\//);
    },
    120_000,
  );
});
