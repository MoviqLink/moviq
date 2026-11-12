import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/config.js';
import { createHttpClient } from '../../src/infrastructure/http/client.js';
import { attemptCollection } from '../../src/modules/data-platform/attempt.js';
import { sourceCatalog } from '../../src/modules/data-platform/catalog.js';
import { credentialsFrom } from '../../src/modules/data-platform/credentials.js';

/**
 * One real request per source, through the whole admission chain: the provider answers, the
 * format is what the parser expects, and the data passes its checks. Run with `npm run
 * verify:live`; a source whose credential is not set fails here with the variable to set, so an
 * integration is only done once this passes with its key.
 */
const loaded = loadConfig(process.env);
if (!loaded.ok) throw new Error(`Configuration error: ${loaded.problems.join('; ')}`);
const credentials = credentialsFrom(loaded.config.integrations);
const http = createHttpClient();

describe('every source against its real provider', () => {
  it.each(sourceCatalog.map((definition) => [definition.id, definition] as const))(
    '%s is admitted',
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
      const explanation =
        attempt.outcome === 'admitted' || attempt.outcome === 'unchanged'
          ? ''
          : `${attempt.errorCode}: ${attempt.detail}`;
      expect(attempt.outcome, explanation).toBe('admitted');
    },
    60_000,
  );
});
