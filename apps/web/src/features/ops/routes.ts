/** The control room's screens, read from and written to the address after `#/ops`. */
export type OpsRoute =
  | { readonly name: 'summary' }
  | { readonly name: 'sources' }
  | { readonly name: 'source'; readonly id: string }
  | { readonly name: 'jobs' }
  | { readonly name: 'money' }
  | { readonly name: 'audit' }
  | { readonly name: 'not-found' };

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The screen for the path segments that follow `ops`. */
export function parseOpsPath(segments: readonly string[]): OpsRoute {
  const [section, id, ...rest] = segments;
  if (rest.length > 0) return { name: 'not-found' };
  if (section === undefined) return { name: 'summary' };
  if (section === 'sources') {
    if (id === undefined) return { name: 'sources' };
    const decoded = decode(id);
    return decoded === null || decoded === ''
      ? { name: 'not-found' }
      : { name: 'source', id: decoded };
  }
  if (id !== undefined) return { name: 'not-found' };
  if (section === 'jobs') return { name: 'jobs' };
  if (section === 'money') return { name: 'money' };
  if (section === 'audit') return { name: 'audit' };
  return { name: 'not-found' };
}

export const opsHref = {
  summary: '#/ops',
  sources: '#/ops/sources',
  source: (id: string) => `#/ops/sources/${encodeURIComponent(id)}`,
  jobs: '#/ops/jobs',
  money: '#/ops/money',
  audit: '#/ops/audit',
} as const;
