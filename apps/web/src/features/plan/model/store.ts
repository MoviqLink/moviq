import { ApiRequestError } from '../../../shared/api/errors';
import { createLatest } from '../../../shared/api/latest';
import type { Lang } from '../../../shared/i18n/lang';
import type { PlanApi } from '../api';
import {
  emptyConversation,
  reduceConversation,
  type ConversationAction,
  type ConversationState,
} from './conversation';

export interface ConversationStore {
  readonly getState: () => ConversationState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Sends a message to Sara unless one is already waiting for an answer. */
  readonly send: (message: string, lang: Lang) => Promise<void>;
  /** Sends again the message that did not get an answer. */
  readonly retry: (lang: Lang) => Promise<void>;
  /** Forgets the conversation and drops any answer still on its way. */
  readonly reset: () => void;
}

/**
 * Keeps the conversation for the whole visit, so going to a trip and back finds it as it was.
 * Only the newest request is alive: a reset cancels it and its answer is never used.
 */
export function createConversationStore(api: Pick<PlanApi, 'turn'>): ConversationStore {
  let state = emptyConversation;
  const listeners = new Set<() => void>();
  const latest = createLatest();

  function dispatch(action: ConversationAction): void {
    const next = reduceConversation(state, action);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  async function ask(lang: Lang): Promise<void> {
    const message = state.pending;
    if (message === null) return;
    const signal = latest.next();
    try {
      const turn = await api.turn({ conversationId: state.conversationId, message, lang }, signal);
      if (!signal.aborted) dispatch({ type: 'answered', turn });
    } catch (error) {
      if (!(error instanceof ApiRequestError)) throw error;
      if (!signal.aborted && error.failure.kind !== 'aborted') {
        dispatch({ type: 'failed', failure: error.failure });
      }
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send(message, lang) {
      if (state.pending !== null) return Promise.resolve();
      dispatch({ type: 'sent', message });
      return ask(lang);
    },
    retry(lang) {
      if (state.pending !== null) return Promise.resolve();
      dispatch({ type: 'retried' });
      return ask(lang);
    },
    reset() {
      latest.cancel();
      dispatch({ type: 'reset' });
    },
  };
}
