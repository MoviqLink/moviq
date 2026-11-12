import type { AssistantTurn, CityAnswer } from '@moviq/contracts';

import type { ApiFailure } from '../../../shared/api/errors';

/** What was said; Sara's words carry what she found about the city in that turn. */
export type Entry =
  | { readonly id: number; readonly from: 'person'; readonly text: string }
  | {
      readonly id: number;
      readonly from: 'sara';
      readonly text: string;
      readonly city: readonly CityAnswer[];
    };

/** The conversation with Sara: what was said, her latest answer and the message on its way. */
export interface ConversationState {
  readonly conversationId: string | null;
  readonly entries: readonly Entry[];
  /** Sara's latest answer: what she understood, what is missing and the plan once complete. */
  readonly turn: AssistantTurn | null;
  /** The message waiting for Sara's answer. */
  readonly pending: string | null;
  /** The message that did not get an answer, kept so it can be sent again. */
  readonly failed: { readonly message: string; readonly failure: ApiFailure } | null;
  readonly nextId: number;
}

export type ConversationAction =
  | { readonly type: 'sent'; readonly message: string }
  | { readonly type: 'retried' }
  | { readonly type: 'answered'; readonly turn: AssistantTurn }
  | { readonly type: 'failed'; readonly failure: ApiFailure }
  | { readonly type: 'reset' };

export const emptyConversation: ConversationState = {
  conversationId: null,
  entries: [],
  turn: null,
  pending: null,
  failed: null,
  nextId: 1,
};

function add(state: ConversationState, entry: DistributiveOmit<Entry, 'id'>) {
  return {
    entries: [...state.entries, { ...entry, id: state.nextId }],
    nextId: state.nextId + 1,
  };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** One step of the conversation. A message is sent only when none is waiting for an answer. */
export function reduceConversation(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case 'sent': {
      const message = action.message.trim();
      if (state.pending !== null || message === '') return state;
      const sent = add(state, { from: 'person', text: message });
      return { ...state, ...sent, pending: message, failed: null };
    }
    case 'retried':
      if (state.pending !== null || state.failed === null) return state;
      return { ...state, pending: state.failed.message, failed: null };
    case 'answered':
      if (state.pending === null) return state;
      return {
        ...state,
        ...add(state, { from: 'sara', text: saidBy(action.turn), city: action.turn.city }),
        conversationId: action.turn.conversationId,
        turn: action.turn,
        pending: null,
      };
    case 'failed':
      if (state.pending === null) return state;
      return {
        ...state,
        pending: null,
        failed: { message: state.pending, failure: action.failure },
      };
    case 'reset':
      return emptyConversation;
  }
}

/**
 * Sara's words with the places she offers numbered after her question, so they can be answered
 * by number here; the Agent screen draws the same options as buttons.
 */
function saidBy(turn: AssistantTurn): string {
  if (turn.choices === undefined) return turn.reply;
  const options = turn.choices.options.map((option, index) => `${String(index + 1)}. ${option}`);
  return `${turn.reply} ${options.join('; ')}.`;
}
