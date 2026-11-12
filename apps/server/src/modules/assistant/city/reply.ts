import type { ConversationState, Lang } from '../planning/state.js';
import { basicNotice, nextQuestion, type BasicReason } from '../planning/replies.js';
import { citySentences, type CityResult } from './words.js';

/** A trip being planned: something of it is known or waiting for the traveller. */
export function planningStarted(state: ConversationState): boolean {
  const { draft } = state;
  return (
    state.plan === null &&
    (draft.destination !== null ||
      draft.origin !== null ||
      draft.arriveBy !== null ||
      draft.flight !== null ||
      state.candidates !== null ||
      state.boardingPass !== null ||
      state.pendingClock !== null)
  );
}

/**
 * The fixed reply to a city question: why it is basic mode, if it is, then what each tool found
 * and, when a trip is being planned, the question it was waiting for.
 */
export function cityReply(input: {
  readonly state: ConversationState;
  readonly results: readonly CityResult[];
  readonly lang: Lang;
  readonly now: Date;
  readonly basic: BasicReason | undefined;
  readonly followUp: boolean;
}): string {
  const say = (en: string, es: string) => (input.lang === 'es' ? es : en);
  const sentences = input.basic === undefined ? [] : [basicNotice(input.basic, say)];
  sentences.push(...citySentences(input.results, input.lang, input.now));
  if (input.followUp) sentences.push(nextQuestion(input.state, say));
  return sentences.join(' ');
}
