import type { TokenBudget } from '../budget.js';
import {
  cityInstants,
  cityWrittenMinutes,
  inLanguage,
  unknownClock,
  unknownNumber,
} from '../city/guard.js';
import type { LanguageModel, ModelStep, ToolResult } from '../model/language-model.js';
import { findPersonalData } from '../privacy.js';
import { localTime, type PlanningPorts } from './actions.js';
import { contextNote, instructions } from './instructions.js';
import { planningToolSpecs, runToolCalls } from './model-tools.js';
import type { BasicReason } from './replies.js';
import type { Turn } from './state.js';

interface AiDependencies {
  readonly model: LanguageModel;
  readonly budget: TokenBudget;
  readonly ports: PlanningPorts;
}

/** `answered`: the model understood; `text` is null when its words did not pass the checks. */
type AiResult =
  | { readonly kind: 'answered'; readonly text: string | null }
  | { readonly kind: 'fallback'; readonly reason: BasicReason };

/** One request and up to three rounds of tools: a turn never loops on the model. */
const MAX_STEPS = 4;
const MAX_REPLY_LENGTH = 700;

/**
 * Lets the model understand the message and use the tools. Before every call, today's budget
 * holds the most the call can use; whatever is about to leave is checked for personal data. If
 * either check fails, or the model gives no valid answer, the turn goes on in basic mode.
 */
export async function aiTurn(deps: AiDependencies, turn: Turn, message: string): Promise<AiResult> {
  const { logger } = deps.ports;
  const context = contextNote(turn.state, turn.now);
  if (blocked(deps, [context, message])) return { kind: 'fallback', reason: 'privacy' };
  const exchange = deps.model.open({
    instructions: instructions(turn.lang),
    context,
    message,
    tools: planningToolSpecs,
  });
  let results: ToolResult[] = [];
  /** What the traveller and the tools said this turn: the only numbers the reply may hold. */
  const given: string[] = [message];
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const reservation = await deps.budget.reserve(deps.model.maxTokensPerStep);
    if (reservation === undefined) return { kind: 'fallback', reason: 'budget' };
    let answer: ModelStep | undefined;
    try {
      answer = await exchange.step(results, turn.signal);
    } finally {
      await deps.budget.settle(reservation, answer?.usage?.totalTokens ?? null);
    }
    if (!answer.ok) {
      logger.warn('assistant model step failed', { reason: answer.reason, detail: answer.detail });
      return { kind: 'fallback', reason: 'model-failed' };
    }
    if (answer.kind === 'text')
      return { kind: 'answered', text: checkedReply(deps, turn, answer.text, given) };
    results = await runToolCalls(answer.calls, deps.ports, turn);
    given.push(...results.map((result) => result.output));
    if (
      blocked(
        deps,
        results.map((result) => result.output),
      )
    ) {
      return { kind: 'fallback', reason: 'privacy' };
    }
  }
  logger.warn('assistant model used every step without answering');
  return { kind: 'answered', text: null };
}

function blocked(deps: AiDependencies, texts: readonly string[]): boolean {
  const kind = findPersonalData(texts);
  if (kind === undefined) return false;
  deps.ports.logger.warn('assistant message blocked before leaving', { kind });
  return true;
}

/**
 * The model's words, unless they are too long, in another language, name a time no source gave
 * or, about the city, hold a number no tool gave.
 */
function checkedReply(
  deps: AiDependencies,
  turn: Turn,
  text: string,
  given: readonly string[],
): string | null {
  const problem =
    text.length > MAX_REPLY_LENGTH
      ? 'too long'
      : !inLanguage(text, turn.lang)
        ? 'wrong language'
        : (unknownTime(text, turn) ??
          (turn.city.length > 0 && unknownNumber(text, given) ? 'unknown number' : undefined));
  if (problem === undefined) return text;
  deps.ports.logger.warn('assistant reply replaced by the fixed reply', { problem });
  return null;
}

/** A clock time in the reply that matches none of the times the sources gave this turn. */
function unknownTime(text: string, turn: Turn): string | undefined {
  return unknownClock(text, knownMinutes(turn)) ? 'unknown time' : undefined;
}

function knownMinutes(turn: Turn): ReadonlySet<number> {
  const { draft, plan, pendingClock, boardingPass } = turn.state;
  const instants = [
    draft.arriveBy,
    draft.flight?.departureAt ?? null,
    draft.flight?.revisedDeparture?.at ?? null,
    boardingPass?.departureAt ?? null,
  ];
  for (const itinerary of plan?.itineraries ?? []) {
    instants.push(itinerary.departAt, itinerary.arriveAt);
    for (const leg of itinerary.legs) instants.push(leg.departAt, leg.arriveAt);
  }
  for (const note of turn.notes) if (note.kind === 'time-passed') instants.push(note.at);
  instants.push(...cityInstants(turn.city));
  const minutes = new Set<number>();
  for (const instant of instants) {
    if (instant === null) continue;
    const [hour = 0, minute = 0] = localTime(new Date(instant)).slice(11).split(':').map(Number);
    minutes.add(hour * 60 + minute);
  }
  for (const minute of cityWrittenMinutes(turn.city)) minutes.add(minute);
  if (pendingClock !== null) {
    minutes.add((pendingClock.hour % 12) * 60 + pendingClock.minute);
    minutes.add(((pendingClock.hour % 12) + 12) * 60 + pendingClock.minute);
  }
  return minutes;
}
