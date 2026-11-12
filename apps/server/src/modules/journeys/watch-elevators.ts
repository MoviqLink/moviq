import {
  toInstant,
  type Incident,
  type Itinerary,
  type Journey,
  type Provenance,
} from '@moviq/contracts';

import { toNewYorkWallClockText } from '../../infrastructure/clock/new-york.js';
import { itineraryAccessibility, type PlatformAccess } from './accessibility.js';
import { stationFindings } from './engine/step-free.js';
import { STEP_FREE_LIST_NAMES, type StepFreeReading } from './step-free-lists.js';
import type { Assessment } from './watch-assess.js';

type Elevator = PlatformAccess['elevators'][number];

/** The trip's window: from now to the deadline, as the routing engine plans it. */
const windowOf = (journey: Journey, now: Date) => ({
  from: now,
  to: new Date(journey.request.arriveBy),
});

/** What the elevators say about a journey this round. */
interface ElevatorCheck {
  readonly incidents: readonly Incident[];
  /**
   * For a step-free journey: `broken` when a platform still to use is not step-free or cannot be
   * confirmed, `unchecked` when the lists cannot be read; undefined when the route holds.
   */
  readonly verdict:
    { readonly kind: 'broken' | 'unchecked'; readonly evidence: string } | undefined;
}

/** `16:01` on the same New York day, `2026-11-09 16:01` before. */
function mtaTime(instant: string, now: Date): string {
  const text = toNewYorkWallClockText(new Date(instant));
  const today = toNewYorkWallClockText(now).slice(0, 10);
  return text.startsWith(today) ? text.slice(11, 16) : `${text.slice(0, 10)} ${text.slice(11, 16)}`;
}

function outageSentence(elevator: Elevator, station: string, now: Date): string {
  const serving = elevator.serving === null ? '' : ` (${elevator.serving})`;
  const what = `elevator ${elevator.id} at ${station}${serving}`;
  const back =
    elevator.estimatedReturn === null
      ? ''
      : `, back about ${mtaTime(elevator.estimatedReturn, now)}`;
  if (elevator.since === null) return `The MTA lists ${what} as out of service${back}.`;
  const since = mtaTime(elevator.since, now);
  return elevator.upcoming
    ? `The MTA announces ${what} out of service from ${since}${back}.`
    : `The MTA says ${what} is out of service since ${since}${back}.`;
}

function unknownSentence(
  elevator: Elevator,
  station: string,
  cause: PlatformAccess['cause'],
): string {
  const list = cause === 'inactive' ? 'equipment list marks' : 'inventory lists';
  const state = cause === 'inactive' ? 'inactive' : 'not in service';
  return (
    `The MTA ${list} elevator ${elevator.id} at ${station} as ${state}, so its step-free path ` +
    'cannot be confirmed.'
  );
}

function provenanceOf(platform: PlatformAccess, reading: StepFreeReading): Provenance {
  if (platform.cause === 'inactive') return reading.provenance.equipment;
  if (platform.cause === 'not-in-service') return reading.provenance.inventory;
  return reading.provenance.outages;
}

/** The platforms still to use: where to board before departure, where to leave before arrival. */
function ahead(
  journey: Journey,
  platforms: readonly PlatformAccess[],
  now: Date,
): PlatformAccess[] {
  return platforms.filter((platform) => {
    const leg = journey.itinerary.legs[platform.legIndex];
    const at = platform.at === 'board' ? leg?.departAt : leg?.arriveAt;
    return at !== undefined && Date.parse(at) >= now.getTime();
  });
}

function elevatorIncidents(
  platforms: readonly PlatformAccess[],
  reading: StepFreeReading,
  stepFree: boolean,
  now: Date,
): Incident[] {
  const tail = stepFree
    ? ' Your step-free route needs it.'
    : ' It matters only if you need step-free access.';
  const seen = new Set<string>();
  const incidents: Incident[] = [];
  const unplaced = platforms.find((platform) => platform.cause === 'outage-unplaced');
  if (stepFree && unplaced !== undefined) {
    incidents.push({
      id: 'elevator:unplaced',
      at: toInstant(now),
      legIndex: unplaced.legIndex,
      kind: 'elevator',
      evidence:
        'The MTA reports an elevator out of service that cannot be placed on a station, so ' +
        'whether your step-free route needs it cannot be told.',
      provenance: reading.provenance.outages,
      impactMinutes: null,
    });
  }
  for (const platform of platforms) {
    for (const elevator of platform.elevators) {
      if (seen.has(elevator.id)) continue;
      seen.add(elevator.id);
      const sentence =
        platform.cause === 'outage'
          ? outageSentence(elevator, platform.station, now)
          : unknownSentence(elevator, platform.station, platform.cause);
      incidents.push({
        id: `elevator:${String(platform.legIndex)}:${elevator.id}`,
        at: toInstant(now),
        legIndex: platform.legIndex,
        kind: 'elevator',
        evidence: `${sentence}${tail}`,
        provenance: provenanceOf(platform, reading),
        impactMinutes: null,
      });
    }
  }
  return incidents;
}

function downIncidents(reading: StepFreeReading, legIndex: number, now: Date): Incident[] {
  if (reading.ok) return [];
  return reading.down.map((provenance) => ({
    id: `source-down:step-free:${provenance.sourceId}`,
    at: toInstant(now),
    legIndex,
    kind: 'source-down',
    evidence:
      `The MTA ${STEP_FREE_LIST_NAMES[provenance.sourceId] ?? provenance.sourceId} cannot be ` +
      `used, so the step-free route is not confirmed: ${provenance.evidence}`,
    provenance,
    impactMinutes: null,
  }));
}

/** Why the first platform still to use breaks a step-free route, in one sentence. */
function brokenSentence(platform: PlatformAccess): string {
  const elevator = platform.elevators[0];
  if (platform.state === 'elevator-out' && elevator !== undefined) {
    return (
      `The step-free route needs elevator ${elevator.id} at ${platform.station}, which is out ` +
      'of service; looking for another way.'
    );
  }
  if (platform.state === 'not-step-free') {
    return (
      `The MTA station list gives this platform at ${platform.station} no step-free access; ` +
      'looking for another way.'
    );
  }
  if (platform.cause === 'outage-unplaced') {
    return (
      'The MTA reports an elevator out that cannot be placed on a station, so the step-free ' +
      'route cannot be confirmed; looking for another way.'
    );
  }
  return `The step-free path at ${platform.station} cannot be confirmed; looking for another way.`;
}

/**
 * Crosses the platforms a journey has still to use with the elevators out or not working now
 * and those announced inside its window. Every journey gets the `elevator` incidents, as a
 * warning when it is not step-free; a step-free one also learns when its route no longer holds,
 * and a `source-down` for each list that cannot be read, never silence.
 */
export function checkElevators(
  journey: Journey,
  reading: StepFreeReading,
  now: Date,
): ElevatorCheck {
  const { stepFree, modes } = journey.request.preferences;
  const all = itineraryAccessibility(journey.itinerary, modes, reading, windowOf(journey, now));
  const platforms = ahead(journey, all.platforms, now);
  const subway = platforms.find(
    (platform) => journey.itinerary.legs[platform.legIndex]?.mode === 'subway',
  );
  if (subway === undefined) return { incidents: [], verdict: undefined };
  if (!reading.ok) {
    if (!stepFree) return { incidents: [], verdict: undefined };
    const names = reading.down.map((p) => STEP_FREE_LIST_NAMES[p.sourceId] ?? p.sourceId);
    return {
      incidents: downIncidents(reading, subway.legIndex, now),
      verdict: {
        kind: 'unchecked',
        evidence:
          `The MTA ${names.join(', ')} cannot be read now, so the step-free route is not ` +
          'confirmed.',
      },
    };
  }
  const incidents = elevatorIncidents(platforms, reading, stepFree, now);
  const broken = platforms.find(
    (platform) => platform.state !== 'accessible' && platform.state !== 'one-direction',
  );
  return {
    incidents,
    verdict:
      !stepFree || broken === undefined
        ? undefined
        : { kind: 'broken', evidence: brokenSentence(broken) },
  };
}

/**
 * The assessment with the elevators: their incidents always; for a step-free journey, a broken
 * route makes it `at-risk` (never better than it was) and looks for alternatives, and lists
 * that cannot be read make an `on-track` journey `unknown`.
 */
export function withElevators(assessment: Assessment, check: ElevatorCheck): Assessment {
  const incidents = [...assessment.incidents, ...check.incidents];
  const { verdict } = check;
  if (verdict === undefined) return { ...assessment, incidents };
  if (verdict.kind === 'unchecked') {
    return assessment.status === 'on-track'
      ? { ...assessment, incidents, status: 'unknown', evidence: verdict.evidence }
      : { ...assessment, incidents };
  }
  const worse = assessment.status === 'late' || assessment.status === 'at-risk';
  return {
    ...assessment,
    incidents,
    status: worse ? assessment.status : 'at-risk',
    evidence: worse ? assessment.evidence : verdict.evidence,
    needsAlternatives: true,
  };
}

/** An itinerary of a step-free journey with its step-free check of now; any other as it is. */
export function withAccessibility(
  itinerary: Itinerary,
  journey: Journey,
  reading: StepFreeReading,
  now: Date,
): Itinerary {
  const { stepFree, modes } = journey.request.preferences;
  if (!stepFree) return itinerary;
  const accessibility = itineraryAccessibility(itinerary, modes, reading, windowOf(journey, now));
  return { ...itinerary, accessibility };
}

/**
 * Why a step-free journey got no alternative: the routing engine's `no-step-free-data`, with the
 * reason read from the same lists (not usable, an elevator out that cannot be placed, or else
 * the modes asked have no step-free data). Null for any other answer.
 */
export function stepFreeRefusal(
  refused: { readonly code: string; readonly detail: string } | undefined,
  reading: StepFreeReading,
  journey: Journey,
  now: Date,
): Journey['watch']['stepFreeRefusal'] {
  if (refused?.code !== 'no-step-free-data' || !journey.request.preferences.stepFree) return null;
  if (!reading.ok) return { reason: 'lists-unavailable', detail: refused.detail };
  const { unmatched } = stationFindings(reading.lists, windowOf(journey, now));
  const reason = unmatched.length > 0 ? 'outage-unplaced' : 'modes-without-data';
  return { reason, detail: refused.detail };
}
