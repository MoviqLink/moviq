import { createHash } from 'node:crypto';

import { unixSeconds, type ExtractedEvent } from '../events.js';
import type { OpenIncidents, VersionContext } from '../extractor.js';

/** Something that is published while it lasts: an alert, an outage, an airport programme. */
export interface IncidentItem {
  readonly id: string;
  readonly kind: string;
  readonly type: string;
  readonly routes: readonly string[];
  /** Changes when what is published about it changes. */
  readonly fingerprint: string;
}

/** A short fingerprint of what is published about an incident. */
export function fingerprintOf(content: unknown): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 12);
}

/**
 * The life of incidents from one version to the next: opened when first published, changed when
 * what is said about it changes, closed when no longer published. It starts from the incidents
 * still open in the registry, so a restart or a new day does not open them again.
 */
export function createLifecycle<T>(
  open: OpenIncidents,
  describe: (data: T, at: number) => IncidentItem[],
) {
  const state = new Map(open);
  return (data: T, context: VersionContext): ExtractedEvent[] => {
    const at = unixSeconds(context.dataTime);
    const last =
      context.previousDataTime === undefined ? undefined : unixSeconds(context.previousDataTime);
    const events: ExtractedEvent[] = [];
    const seen = new Set<string>();
    for (const item of describe(data, at)) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const before = state.get(item.id);
      if (before?.fingerprint === item.fingerprint) continue;
      const k = before === undefined ? 'open' : 'change';
      const routes = [...new Set(item.routes)].sort();
      events.push({
        k,
        t: at,
        id: item.id,
        kind: item.kind,
        type: item.type,
        routes,
        fp: item.fingerprint,
      });
      state.set(item.id, { fingerprint: item.fingerprint, since: before?.since ?? at });
    }
    for (const [id, before] of state) {
      if (seen.has(id)) continue;
      events.push({
        k: 'close',
        t: at,
        id,
        since: before.since,
        last: Math.max(before.since, last ?? before.since),
      });
      state.delete(id);
    }
    return events;
  };
}
