type FailureKind = 'initialization' | 'resource' | 'context-lost' | 'timeout';

/** Local operational diagnostics only: no location, user agent, identity or browsing history. */
export function createMapDiagnostics() {
  let sent = 0;
  const seen = new Set<string>();
  return (kind: FailureKind, error: unknown): void => {
    const raw =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Unknown map failure';
    const source = /orthos\.its\.ny\.gov|basemap\.nationalmap\.gov/u.test(raw)
      ? 'aerial'
      : /worker/i.test(raw)
        ? 'worker'
        : raw.includes('tiles.openfreemap.org')
          ? 'base'
          : 'unknown';
    const message = raw
      .replaceAll(/https?:\/\/\S+/gu, '[resource]')
      .replaceAll(/(?:\/Users|\/Volumes|\/private)\/[^\s]+/gu, '[path]')
      .replaceAll(/\s+/gu, ' ')
      .slice(0, 300);
    const key = `${kind}:${message}`;
    if (sent >= 4 || seen.has(key)) return;
    sent += 1;
    seen.add(key);
    void fetch('/api/diagnostics/map', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, source, message }),
      keepalive: true,
    }).catch(() => undefined);
  };
}
