import { describe, expect, it } from 'vitest';

import { opsHref, parseOpsPath } from '../src/features/ops/routes';
import { hashSegments } from '../src/shared/routing/hash';

const route = (hash: string) => {
  const [area, ...rest] = hashSegments(hash);
  expect(area).toBe('ops');
  return parseOpsPath(rest);
};

describe('control room addresses', () => {
  it('open each screen from its address', () => {
    expect(route('#/ops')).toEqual({ name: 'summary' });
    expect(route('#/ops/sources')).toEqual({ name: 'sources' });
    expect(route('#/ops/jobs')).toEqual({ name: 'jobs' });
    expect(route('#/ops/audit')).toEqual({ name: 'audit' });
  });

  it('round-trip a source id, even one that needs encoding', () => {
    expect(route(opsHref.source('mta-alerts'))).toEqual({ name: 'source', id: 'mta-alerts' });
    expect(route(opsHref.source('a/b c'))).toEqual({ name: 'source', id: 'a/b c' });
  });

  it('say not found for anything else', () => {
    expect(route('#/ops/nope')).toEqual({ name: 'not-found' });
    expect(route('#/ops/jobs/7')).toEqual({ name: 'not-found' });
    expect(route('#/ops/sources/a/b')).toEqual({ name: 'not-found' });
    expect(route('#/ops/sources/%E0%A4%A')).toEqual({ name: 'not-found' });
  });
});
