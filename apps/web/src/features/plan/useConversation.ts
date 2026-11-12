import { useSyncExternalStore } from 'react';

import { planApi } from './api';
import type { ConversationState } from './model/conversation';
import { createConversationStore, type ConversationStore } from './model/store';

const store = createConversationStore(planApi);

/** The conversation of this visit and the actions on it; the screen re-renders on each change. */
export function useConversation(): [ConversationState, ConversationStore] {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return [state, store];
}
