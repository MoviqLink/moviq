import { toInstant, type AirportCode, type Provenance } from '@moviq/contracts';

import type { Clock } from '../../../infrastructure/clock/clock.js';
import type { ProviderOutcome } from '../../journeys/ports.js';
import { PROVIDER } from './aerodatabox-answer.js';
import {
  FIDS_MAX_BYTES,
  FIDS_UNITS,
  fidsUrl,
  readSnapshot,
  type AirportSnapshot,
} from './aerodatabox-fids.js';
import type { AeroDataBoxGateway } from './aerodatabox-gateway.js';
import { refusalText, type BoardBudget } from './board-budget.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** One board per airport every 3 hours at most, and only when someone asks for it. */
const BOARD_REFRESH_MS = 3 * HOUR_MS;
/** A failed board is not asked again sooner, so a provider down costs nothing more. */
const FAILURE_RETRY_MS = 15 * MINUTE_MS;
/** AeroDataBox's free plan allows keeping its data 7 days: an older board is dropped. */
const BOARD_KEPT_MS = 7 * 24 * HOUR_MS;

/** Codes the gateway answers without sending anything: they spend no units. */
const NOT_SENT: ReadonlySet<string> = new Set(['missing-credential', 'monthly-units']);

export interface BoardReading {
  /** `current`: within its 3 hours; `kept`: older, as no newer one could be taken; `none`. */
  readonly state: 'current' | 'kept' | 'none';
  readonly snapshot: AirportSnapshot | null;
  /** AeroDataBox's state for this airport, with its age and why a board is kept or missing. */
  readonly provenance: Provenance;
  readonly nextRefreshAt: Date | null;
}

export interface AirportBoards {
  /** The airport's board, refreshed when due and allowed; never more than one request at once. */
  read(code: AirportCode): Promise<BoardReading>;
}

interface Kept {
  snapshot: AirportSnapshot | null;
  /** The last failure and when the airport may be asked again. */
  failure: { readonly outcome: Failure; readonly retryAt: Date } | null;
}

type Failure = Extract<ProviderOutcome<unknown>, { readonly ok: false }>;

interface AirportBoardsOptions {
  readonly gateway: AeroDataBoxGateway;
  readonly budget: BoardBudget;
  readonly clock: Clock;
}

/** The boards of JFK, LaGuardia and Newark, each kept in memory with its time. */
export function createAirportBoards(options: AirportBoardsOptions): AirportBoards {
  const { gateway, budget, clock } = options;
  const kept = new Map<AirportCode, Kept>();
  const running = new Map<AirportCode, Promise<BoardReading>>();

  const refresh = async (code: AirportCode, entry: Kept): Promise<BoardReading> => {
    const sentAt = clock.now();
    const answer = await gateway.get(
      { url: fidsUrl(code), units: FIDS_UNITS, maxBytes: FIDS_MAX_BYTES },
      { lookedUp: 'airport boards' },
    );
    if (answer.ok || !NOT_SENT.has(answer.code)) budget.spent(FIDS_UNITS, sentAt);
    const outcome = answer.ok ? readSnapshot(answer.value, code) : answer;
    if (outcome.ok) {
      entry.snapshot = outcome.value;
      entry.failure = null;
      return current(outcome.value, clock.now());
    }
    entry.failure = { outcome, retryAt: new Date(clock.now().getTime() + FAILURE_RETRY_MS) };
    return failed(entry, entry.failure, clock.now());
  };

  /** The board without asking: current, or kept while a failure cools down or units lack. */
  const settled = (entry: Kept, now: Date): BoardReading | undefined => {
    const age = entry.snapshot === null ? 0 : now.getTime() - entry.snapshot.takenAt.getTime();
    if (age > BOARD_KEPT_MS) entry.snapshot = null;
    if (entry.snapshot !== null && age < BOARD_REFRESH_MS) return current(entry.snapshot, now);
    if (entry.failure !== null && entry.failure.retryAt.getTime() > now.getTime()) {
      return failed(entry, entry.failure, now);
    }
    const refusal = gateway.configured ? budget.refusal(FIDS_UNITS, now) : undefined;
    if (refusal === undefined) return undefined;
    return keptOrNone(entry, now, {
      state: 'rate_limited',
      evidence: refusalText(refusal),
      retryAt: refusal.retryAt,
    });
  };

  return {
    read(code) {
      const pending = running.get(code);
      if (pending !== undefined) return pending;
      const entry = kept.get(code) ?? { snapshot: null, failure: null };
      kept.set(code, entry);
      const reading = settled(entry, clock.now());
      if (reading !== undefined) return Promise.resolve(reading);
      const run = refresh(code, entry).finally(() => running.delete(code));
      running.set(code, run);
      return run;
    },
  };
}

/** A failed request: no retry date without a key, since none will be sent until it is set. */
function failed(entry: Kept, failure: NonNullable<Kept['failure']>, now: Date): BoardReading {
  const { outcome, retryAt } = failure;
  return keptOrNone(entry, now, {
    state: outcome.state,
    evidence: outcome.detail,
    retryAt: outcome.code === 'missing-credential' ? null : retryAt,
  });
}

function current(snapshot: AirportSnapshot, now: Date): BoardReading {
  return {
    state: 'current',
    snapshot,
    provenance: provenanceOf(snapshot, now, {
      state: 'healthy',
      evidence: `${PROVIDER}'s ${snapshot.code} board of ${toInstant(snapshot.takenAt)}.`,
    }),
    nextRefreshAt: new Date(snapshot.takenAt.getTime() + BOARD_REFRESH_MS),
  };
}

interface Why {
  readonly state: Provenance['state'];
  readonly evidence: string;
  readonly retryAt: Date | null;
}

function keptOrNone(entry: Kept, now: Date, why: Why): BoardReading {
  const { snapshot } = entry;
  const evidence =
    snapshot === null
      ? `No board yet. ${why.evidence}`
      : `Board of ${toInstant(snapshot.takenAt)} kept. ${why.evidence}`;
  return {
    state: snapshot === null ? 'none' : 'kept',
    snapshot,
    provenance: provenanceOf(snapshot, now, { state: why.state, evidence }),
    nextRefreshAt: why.retryAt,
  };
}

function provenanceOf(
  snapshot: AirportSnapshot | null,
  now: Date,
  status: Pick<Provenance, 'state' | 'evidence'>,
): Provenance {
  const takenAt = snapshot?.takenAt ?? null;
  return {
    sourceId: 'aerodatabox',
    dataTime: takenAt === null ? null : toInstant(takenAt),
    receivedAt: takenAt === null ? null : toInstant(takenAt),
    ageSeconds:
      takenAt === null ? null : Math.max(0, Math.round((now.getTime() - takenAt.getTime()) / 1000)),
    ...status,
  };
}
