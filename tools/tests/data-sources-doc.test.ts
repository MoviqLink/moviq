import { describe, expect, it } from 'vitest';

import { testSource } from '../../apps/server/tests/support/sources.js';
import { renderDataSources } from '../data-sources-doc.js';

describe('renderDataSources', () => {
  it('lists each source with its licence, rhythm, freshness and credential, and the credits', () => {
    const text = renderDataSources([
      testSource({ id: 'b-feed', provider: 'Zeta' }),
      testSource({ id: 'a-feed', provider: 'Alpha', integration: 'mta-bus-time' }),
    ]);
    const rows = text.split('\n').filter((line) => line.startsWith('| `'));
    expect(rows[0]?.split(' | ')).toEqual([
      '| `a-feed`',
      'Test feed',
      'Alpha',
      '[Test licence](https://example.com/licence)',
      'hot: 60 s, 15 s with interest',
      '60 s / 5 min / 60 min',
      'mta-bus-time |',
    ]);
    expect(rows[1]).toContain('| `b-feed` |');
    expect(text).toContain('## Credits\n\n- Test provider\n');
  });
});
