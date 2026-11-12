import { randomUUID } from 'node:crypto';

import {
  assistantTurnSchema,
  type AssistantTurn,
  type assistantTurnRequestSchema,
  type Journey,
} from '@moviq/contracts';
import type { z } from 'zod';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { Logger } from '../../infrastructure/telemetry/logger.js';
import type { CommerceDependencies } from '../commerce/context.js';
import type { SourceReader } from '../data-platform/reader.js';
import type { FlightFinder, Geocoder, JourneyPlanner } from '../journeys/ports.js';
import type { LiveCity } from '../live/city.js';
import { journeyPurchases } from '../journeys/purchases.js';
import type { TicketAutopayService } from '../tickets/autopay.js';
import type { TokenBudget } from './budget.js';
import { cityReply, planningStarted } from './city/reply.js';
import { cityCards } from './city/words.js';
import { conversationStore } from './conversations.js';
import { createJourneyExplainer } from './journey/explain.js';
import { tripTurn, type TripQuestion } from './journey/trip-turn.js';
import type { LanguageModel } from './model/language-model.js';
import {
  airportQuery,
  findPlace,
  settlePlan,
  type PlanningPorts,
  type RewardToolContext,
  type LineWatches,
} from './planning/actions.js';
import { ticketReply } from './planning/ticket-words.js';
import { watchReply } from './planning/watch-tools.js';
import { readSentence } from './understanding/reader.js';
import { aiTurn } from './planning/ai-turn.js';
import { basicTurn } from './planning/basic-turn.js';
import { fixedReply, type BasicReason } from './planning/replies.js';
import { emptyState, missingSlots, type ConversationState, type Turn } from './planning/state.js';
import { scrubPersonalData } from './privacy.js';

type AssistantTurnRequest = z.infer<typeof assistantTurnRequestSchema>;

interface SaraDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly geocoder: Geocoder;
  readonly flights: FlightFinder;
  readonly planner: JourneyPlanner;
  /** The data platform, read for lines, incidents, stations and the recorder's statistics. */
  readonly reader: SourceReader;
  /** The city Explore shows: vehicles with their position and its basis. */
  readonly live: Pick<LiveCity, 'snapshot'>;
  /** Undefined without `OPENAI_API_KEY`: Sara then works in basic mode and says so. */
  readonly model: LanguageModel | undefined;
  readonly budget: TokenBudget;
  /** The demo merchants on the way, asked when the traveller fancies something on a trip. */
  readonly commerce?: CommerceDependencies;
  /** How Sara pays for tickets with the PayPal the traveller connected. */
  readonly tickets?: Pick<TicketAutopayService, 'buy'>;
  /** How Sara starts a watch of a line when asked in plain words. */
  readonly watches?: LineWatches;
}

export interface Sara {
  turn(
    request: AssistantTurnRequest,
    travellerId: string,
    logger: Logger,
    signal?: AbortSignal,
  ): Promise<AssistantTurn>;
  /** A question about one of the traveller's trips; undefined when the trip is not theirs. */
  tripTurn(
    question: TripQuestion,
    travellerId: string,
    logger: Logger,
    signal?: AbortSignal,
  ): Promise<AssistantTurn | undefined>;
  /** The traveller's trip with Sara's words on its latest change; undefined when not theirs. */
  explain(
    journeyId: string,
    travellerId: string,
    lang: 'en' | 'es',
    logger: Logger,
  ): Promise<Journey | undefined>;
}

/**
 * Sara for planning: she understands where the traveller is going and when they must be there,
 * asks only for what is missing, and hands over the plan once she has it all. The model, when
 * there is one and today's budget allows it, understands the words; otherwise the basic reader
 * does, and the reply says so.
 */
export function createSara(deps: SaraDependencies): Sara {
  const explainer = createJourneyExplainer(deps);
  // The same quote the payment is created with: the server sets every price Sara says.
  const catalog = journeyPurchases({ db: deps.db, clock: deps.clock });
  const portsFor = (logger: Logger): PlanningPorts => ({
    ...deps,
    city: { reader: deps.reader, live: deps.live, db: deps.db },
    logger,
  });
  /** The rewards of this trip, with the alias and tastes the device sent; never for the model. */
  const rewardsFor = (
    question: TripQuestion,
    travellerId: string,
    logger: Logger,
  ): { readonly rewards?: RewardToolContext } => {
    const { shopper } = question;
    if (deps.commerce === undefined || shopper === undefined) return {};
    const { journeyId, lang: language } = question;
    const { alias, taste } = shopper;
    const context = { deps: deps.commerce, logger, travellerId, journeyId, alias, taste, language };
    return { rewards: context };
  };
  return {
    tripTurn: (question, travellerId, logger, signal) => {
      const ports = { ...portsFor(logger), ...rewardsFor(question, travellerId, logger) };
      return tripTurn({ ...deps, catalog }, ports, question, travellerId, signal);
    },
    explain: (journeyId, travellerId, lang, logger) =>
      explainer.explain(journeyId, travellerId, lang, logger),
    async turn(request, travellerId, logger, signal) {
      const now = deps.clock.now();
      const known =
        request.conversationId === null
          ? undefined
          : await conversationStore.load(deps.db, request.conversationId, travellerId, now);
      const conversationId =
        known === undefined || request.conversationId === null
          ? randomUUID()
          : request.conversationId;
      const turn: Turn = {
        state: known ?? emptyState(),
        notes: [],
        city: [],
        lang: request.lang,
        now,
        travellerId,
        signal,
      };
      const ports = portsFor(logger);
      const planning = planningStarted(turn.state);
      const message = scrubPersonalData(request.message);
      const answer = await understand(deps, ports, turn, message);
      await settlePlan(ports, turn);
      // A city question asks nothing of the trip, unless one was being planned.
      const followUp = planning && turn.notes.length === 0 && turn.state.plan === null;
      // What Sara did is told with the server's own words: tickets, prices, orders, watches.
      const reply = actionReply(turn) ?? answer.text ?? replyOf(turn, answer.basic, followUp);
      const offered = offeredChoices(turn.state);
      turn.state.asked =
        turn.city.length > 0 && turn.notes.length === 0 && !followUp ? null : nextAsked(turn.state);
      await conversationStore.save(deps.db, conversationId, travellerId, turn.state, now);
      return assistantTurnSchema.parse({
        conversationId,
        mode: answer.basic === undefined && answer.deterministic !== true ? 'ai' : 'basic',
        reply: offered.choices === undefined ? reply : questionOnly(reply),
        draft: turn.state.draft,
        missing: missingSlots(turn.state.draft),
        plan: turn.state.plan,
        city: cityCards(turn.city, turn.lang, now),
        ...offered,
        ...boughtTickets(turn),
      });
    },
  };
}

/** The model's words when it answered well, or the fixed reply and, in basic mode, why. */
async function understand(
  deps: SaraDependencies,
  ports: PlanningPorts,
  turn: Turn,
  message: string,
): Promise<{
  readonly text: string | null;
  readonly basic: BasicReason | undefined;
  readonly deterministic?: boolean;
}> {
  const pending = turn.state.pendingAirport;
  if (
    pending !== null &&
    /^(?:s[ií]|yes|correcto|correct|eso|exacto)[.!]?$|^(?:no|nope)[.!]?$/i.test(message.trim())
  ) {
    turn.state.pendingAirport = null;
    if (/^(?:s[ií]|yes|correcto|correct|eso|exacto)/i.test(message.trim())) {
      await findPlace(ports, turn, pending.slot, airportQuery(pending.airport));
    } else {
      turn.notes.push({ kind: 'airport-which' });
    }
    return { text: null, basic: undefined, deterministic: true };
  }
  const read = readSentence(message, turn.now);
  const destination =
    read.destination ?? (turn.state.asked === 'destination' ? read.plain : undefined);
  if (
    read.flight === undefined &&
    destination !== undefined &&
    (/^(?:el |la |the )?(?:airport|aeropuerto)$/i.test(destination) || /^jfkl$/i.test(destination))
  ) {
    await basicTurn(ports, turn, message);
    return { text: null, basic: undefined, deterministic: true };
  }
  if (deps.model === undefined) {
    await basicTurn(ports, turn, message);
    return { text: null, basic: 'no-model' };
  }
  const result = await aiTurn({ model: deps.model, budget: deps.budget, ports }, turn, message);
  if (result.kind === 'fallback') {
    await basicTurn(ports, turn, message);
    return { text: null, basic: result.reason };
  }
  // A plan made only after the model answered is told with the fixed words, which hold its times.
  const planPending = turn.state.plan === null && missingSlots(turn.state.draft).length === 0;
  const precisePlaceReply = turn.notes.some(
    (note) =>
      note.kind === 'place-not-found' ||
      note.kind === 'places-unavailable' ||
      note.kind === 'airport-which' ||
      note.kind === 'airport-confirm',
  );
  return { text: planPending || precisePlaceReply ? null : result.text, basic: undefined };
}

/** The fixed words: the city answers first, then what happened to the trip this turn. */
function replyOf(turn: Turn, basic: BasicReason | undefined, followUp: boolean): string {
  const { state, notes, lang, now } = turn;
  if (turn.city.length === 0) return fixedReply({ state, notes, lang, now, basic });
  const city = cityReply({ state, results: turn.city, lang, now, basic, followUp });
  if (notes.length === 0) return city;
  return `${city} ${fixedReply({ state, notes, lang, now, basic: undefined })}`;
}

/** The question the reply ends with, so a short answer next time fills it. */
function nextAsked(state: ConversationState): ConversationState['asked'] {
  if (state.plan !== null) return null;
  if (state.candidates !== null) return state.candidates.slot;
  // The boarding pass's departure time sets when to be at the airport.
  if (state.pendingClock !== null || state.boardingPass !== null) return 'arriveBy';
  return missingSlots(state.draft)[0] ?? null;
}

/** The tickets bought this turn, for the web to show as passes; nothing when none was bought. */
function boughtTickets(turn: Turn): Pick<AssistantTurn, 'tickets'> {
  if (turn.tickets?.kind !== 'bought') return {};
  const tickets = turn.tickets.receipts.flatMap((receipt) =>
    receipt.bought
      ? [
          {
            id: receipt.ticketId,
            name: receipt.product.name,
            operator: receipt.product.operator,
            price: receipt.product.price,
            paidWith: receipt.paidWith,
            paypalOrderId: receipt.paypalOrderId,
          },
        ]
      : [],
  );
  return tickets.length === 0 ? {} : { tickets };
}

/** The places waiting for the traveller's choice, for the web to show as buttons. */
function offeredChoices(state: ConversationState): Pick<AssistantTurn, 'choices'> {
  const { candidates } = state;
  if (candidates === null || state.plan !== null) return {};
  return {
    choices: { slot: candidates.slot, options: candidates.places.map((place) => place.label) },
  };
}

/**
 * The reply without its numbered list, when the options go as buttons: what comes before
 * "1." is the question. A reply that does not start with a question is left as it is.
 */
function questionOnly(reply: string): string {
  const list = reply.search(/(?:^|\s)1\.\s/);
  const question = list <= 0 ? '' : reply.slice(0, list).trim();
  return question === '' ? reply : question;
}

/** The fixed words for what Sara did this turn: a purchase first, then a watch; null for none. */
function actionReply(turn: Turn): string | null {
  const parts = [
    turn.tickets === undefined ? null : ticketReply(turn.tickets, turn.lang),
    turn.watch === undefined ? null : watchReply(turn.watch, turn.lang),
  ].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join('\n');
}
