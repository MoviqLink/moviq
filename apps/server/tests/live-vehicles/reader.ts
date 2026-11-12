import { toInstant } from '@moviq/contracts';

import type { SourceDefinition } from '../../src/modules/data-platform/definition.js';
import type { SourceReader } from '../../src/modules/data-platform/reader.js';
import { fixture } from './city.js';

/**
 * The data a source makes of its capture, read by its own parser at `receivedAt`. The platform's
 * coverage checks are left out on purpose: they refuse the cut captures, which hold a few rows.
 */
export function parsedCapture<T>(
  definition: SourceDefinition<T>,
  file: string,
  receivedAt: string,
) {
  const parsed = definition.parse(fixture(file), {
    receivedAt: new Date(receivedAt),
    previous: undefined,
  });
  if (!parsed.ok) throw new Error(`${file} does not parse: ${parsed.code}`);
  return parsed.data;
}

/**
 * A double of the platform's reader: each source answers the data it is given, healthy and
 * fresh at `at`, and every other source has nothing, unavailable.
 */
export function readerWith(answers: ReadonlyMap<string, unknown>, at: string): SourceReader {
  return {
    read(definition) {
      const raw = answers.get(definition.id);
      const known = raw !== undefined;
      return Promise.resolve({
        data: known ? definition.dataSchema.parse(raw) : undefined,
        provenance: {
          sourceId: definition.id,
          dataTime: known ? toInstant(new Date(at)) : null,
          receivedAt: known ? toInstant(new Date(at)) : null,
          ageSeconds: known ? 0 : null,
          state: known ? 'healthy' : 'unavailable',
          evidence: known ? 'Served by the test.' : 'Not answered in this test.',
        },
      });
    },
  };
}
