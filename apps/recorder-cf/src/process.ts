import type { RecordedEvent } from '../../server/src/modules/recorder/events.js';
import type { ExtractorSession } from '../../server/src/modules/recorder/extractor.js';
import { auditFixes, type Fixes } from './audit.js';
import { masked } from './collect.js';
import type { RecordedSource } from './sources.js';
import type { PartState } from './state.js';

/** Data dated further ahead of our clock than this is refused as impossible. */
const FUTURE_TOLERANCE_MS = 2 * 60_000;
/** A feed whose data time has not moved for this long, and ten cadences, is frozen. */
const FROZEN_AFTER_MS = 5 * 60_000;

export type PartOutcome =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'rejected'; readonly why: string }
  | {
      readonly kind: 'recorded';
      readonly version: string;
      readonly dataTime: number;
      readonly events: readonly RecordedEvent[];
      readonly audit: readonly string[];
    };

export interface Session {
  readonly day: string;
  readonly session: ExtractorSession;
}

export interface PartInput {
  readonly source: RecordedSource;
  readonly part: number;
  readonly body: Uint8Array;
  readonly partState: PartState;
  readonly receivedAt: Date;
  readonly run: number;
  readonly session: (day: string) => ExtractorSession;
  readonly dayOf: (instant: Date) => string;
  readonly fixes: Fixes;
}

/** A short fingerprint of what was downloaded: the same bytes are never recorded twice. */
async function fingerprint(body: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', body));
  return [...digest.subarray(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Why a candidate's data time is impossible, if it is. */
function impossibleTime(dataTime: Date, receivedAt: Date, last: number | null): string | undefined {
  if (Number.isNaN(dataTime.getTime())) return 'invalid-data-time: the data carries no valid time.';
  if (dataTime.getTime() - receivedAt.getTime() > FUTURE_TOLERANCE_MS)
    return `future-data-time: dated ${dataTime.toISOString()}, ahead of our clock.`;
  if (last !== null && dataTime.getTime() < last * 1000)
    return `older-than-recorded: dated ${dataTime.toISOString()}, before the last version recorded.`;
  return undefined;
}

/** Notes, once per episode, a feed whose data time stays still while it keeps answering. */
function frozenAudit(input: PartInput, dataTime: number): string[] {
  const state = input.partState;
  const now = Math.floor(input.receivedAt.getTime() / 1000);
  if (state.dataTime !== dataTime) {
    const thawed = state.frozen ? [`thawed: data time moves again (${String(dataTime)})`] : [];
    state.sameSince = now;
    state.frozen = false;
    return thawed;
  }
  const limit = Math.max(FROZEN_AFTER_MS, 10 * input.source.everyMs) / 1000;
  if (state.frozen || state.sameSince === null || now - state.sameSince < limit) return [];
  state.frozen = true;
  return [
    `frozen: the data time ${String(dataTime)} has not moved since ${String(state.sameSince)}`,
  ];
}

/**
 * One part of one download: refused when its fingerprint is the last one recorded, when the
 * source's parse or checks refuse it, when its time is impossible, or when the data breaks the
 * schema of the source (the extractor validates it); otherwise its compact events.
 */
export async function processPart(input: PartInput): Promise<PartOutcome> {
  const { source, body, receivedAt } = input;
  const version = await fingerprint(body);
  if (version === input.partState.version) return { kind: 'unchanged' };
  const parsed = source.definition.parse(body, { receivedAt, previous: undefined });
  if (!parsed.ok) return { kind: 'rejected', why: masked(`${parsed.code}: ${parsed.detail}`) };
  const issues = source.definition.check?.(parsed.data, undefined) ?? [];
  if (issues.length > 0)
    return { kind: 'rejected', why: masked(`check-failed: ${issues.join('; ')}`) };
  const impossible = impossibleTime(parsed.dataTime, receivedAt, input.partState.dataTime);
  if (impossible !== undefined) return { kind: 'rejected', why: impossible };
  const dataTime = Math.floor(parsed.dataTime.getTime() / 1000);
  const session = input.session(input.dayOf(parsed.dataTime));
  const previous = input.partState.dataTime;
  const extraction = session.extract(parsed.data, {
    version,
    dataTime: parsed.dataTime,
    previousDataTime: previous === null ? undefined : new Date(previous * 1000),
  });
  if (!extraction.ok) return { kind: 'rejected', why: `schema-mismatch: ${extraction.why}` };
  const audit = [...frozenAudit(input, dataTime), ...auditFixes(input.fixes, extraction.events)];
  input.partState.version = version;
  input.partState.dataTime = dataTime;
  const marker: RecordedEvent = {
    k: 'version',
    v: version,
    t: dataTime,
    run: input.run,
    at: Math.floor(receivedAt.getTime() / 1000),
  };
  const events: RecordedEvent[] = [
    marker,
    ...extraction.events.map((event) => ({ v: version, ...event })),
  ];
  return { kind: 'recorded', version, dataTime, events, audit };
}
