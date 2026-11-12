import { randomUUID } from 'node:crypto';

import { assistantTurnSchema, type AssistantTurn, type Taste } from '@moviq/contracts';

import type { Clock } from '../../../infrastructure/clock/clock.js';
import type { Database } from '../../../infrastructure/database/database.js';
import { journeyStore } from '../../journeys/journey-store.js';
import { cityCards } from '../city/words.js';
import { conversationStore } from '../conversations.js';
import type { PlanningPorts } from '../planning/actions.js';
import { emptyState, missingSlots, type Lang, type Turn } from '../planning/state.js';
import { scrubPersonalData } from '../privacy.js';
import { askAboutJourney, type AskDependencies } from './ask.js';

export interface TripTurnDependencies extends AskDependencies {
  readonly db: Database;
  readonly clock: Clock;
}

export interface TripQuestion {
  readonly conversationId: string | null;
  readonly journeyId: string;
  readonly message: string;
  readonly lang: Lang;
  /** What Sara may tell the merchants on the way; without it, she asks none of them. */
  readonly shopper?: { readonly alias: string; readonly taste: Taste } | undefined;
}

/**
 * One question about a trip of the traveller, as a turn of the conversation: the draft being
 * planned stays as it was, and the answer carries the city cards and the option Sara proposed.
 * Undefined when the trip is not theirs.
 */
export async function tripTurn(
  deps: TripTurnDependencies,
  ports: PlanningPorts,
  question: TripQuestion,
  travellerId: string,
  signal?: AbortSignal,
): Promise<AssistantTurn | undefined> {
  const stored = await journeyStore.get(deps.db, question.journeyId);
  if (stored?.travellerId !== travellerId) return undefined;
  const now = deps.clock.now();
  const known =
    question.conversationId === null
      ? undefined
      : await conversationStore.load(deps.db, question.conversationId, travellerId, now);
  const conversationId =
    known === undefined || question.conversationId === null
      ? randomUUID()
      : question.conversationId;
  const turn: Turn = {
    state: known ?? emptyState(),
    notes: [],
    city: [],
    lang: question.lang,
    now,
    travellerId,
    signal,
  };
  const message = scrubPersonalData(question.message);
  const answer = await askAboutJourney(deps, ports, turn, { journey: stored.journey, message });
  await conversationStore.save(deps.db, conversationId, travellerId, turn.state, now);
  const { proposal, needId } = answer;
  return assistantTurnSchema.parse({
    conversationId,
    mode: answer.mode,
    reply: answer.reply,
    draft: turn.state.draft,
    missing: missingSlots(turn.state.draft),
    plan: turn.state.plan,
    city: cityCards(turn.city, turn.lang, now),
    proposal:
      proposal === null ? null : { alternativeId: proposal.alternativeId, price: proposal.price },
    rewards: needId === null ? null : { needId },
  });
}
