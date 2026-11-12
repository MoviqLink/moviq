import type { AssistantTurn } from '@moviq/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { TurnRequest } from '../src/features/plan/api';
import {
  emptyConversation,
  reduceConversation,
  type ConversationAction,
  type ConversationState,
} from '../src/features/plan/model/conversation';
import { createConversationStore } from '../src/features/plan/model/store';
import { ApiRequestError } from '../src/shared/api/errors';
import { turns } from './fixtures/journeys';

const now = Date.parse('2026-11-11T12:00:00.000Z');
const { asking, complete } = turns(now, 'en');

const run = (actions: ConversationAction[], from: ConversationState = emptyConversation) =>
  actions.reduce(reduceConversation, from);

describe('the conversation with Sara', () => {
  it('records the message, waits, then keeps her answer, what she understood and what is missing', () => {
    const waiting = run([{ type: 'sent', message: '  LaGuardia by 9:15  ' }]);
    expect(waiting.pending).toBe('LaGuardia by 9:15');
    expect(waiting.entries).toEqual([{ id: 1, from: 'person', text: 'LaGuardia by 9:15' }]);

    const answered = reduceConversation(waiting, { type: 'answered', turn: asking });
    expect(answered.pending).toBeNull();
    expect(answered.conversationId).toBe('conv-1');
    expect(answered.turn?.missing).toEqual(['origin']);
    expect(answered.entries.map((entry) => entry.from)).toEqual(['person', 'sara']);
  });

  it('sends nothing empty and nothing while an answer is on its way', () => {
    expect(run([{ type: 'sent', message: '   ' }])).toBe(emptyConversation);
    const waiting = run([{ type: 'sent', message: 'first' }]);
    expect(reduceConversation(waiting, { type: 'sent', message: 'second' })).toBe(waiting);
  });

  it('keeps a message that got no answer and sends it again without repeating it', () => {
    const failed = run([
      { type: 'sent', message: 'From 125 St' },
      { type: 'failed', failure: { kind: 'network', timedOut: false } },
    ]);
    expect(failed.failed?.message).toBe('From 125 St');
    const retried = reduceConversation(failed, { type: 'retried' });
    expect(retried.pending).toBe('From 125 St');
    expect(retried.failed).toBeNull();
    expect(retried.entries).toHaveLength(1);
  });

  it('ignores an answer when nothing was asked and forgets everything on reset', () => {
    expect(reduceConversation(emptyConversation, { type: 'answered', turn: asking })).toBe(
      emptyConversation,
    );
    const done = run([
      { type: 'sent', message: 'x' },
      { type: 'answered', turn: complete },
    ]);
    expect(done.turn?.plan?.planId).toBe('plan-1');
    expect(reduceConversation(done, { type: 'reset' })).toEqual(emptyConversation);
  });
});

describe('the conversation store', () => {
  it('sends the conversation id Sara gave and the language in use', async () => {
    const calls: TurnRequest[] = [];
    const store = createConversationStore({
      turn: (body: TurnRequest) => {
        calls.push(body);
        return Promise.resolve(calls.length === 1 ? asking : complete);
      },
    });
    await store.send('LaGuardia Terminal B by 9:15', 'es');
    await store.send('From 125 St and Lexington', 'es');
    expect(calls).toEqual([
      { conversationId: null, message: 'LaGuardia Terminal B by 9:15', lang: 'es' },
      { conversationId: 'conv-1', message: 'From 125 St and Lexington', lang: 'es' },
    ]);
    expect(store.getState().turn?.missing).toEqual([]);
    expect(store.getState().turn?.plan).not.toBeNull();
  });

  it('records a failure with its kind and retries the same message for real', async () => {
    const turn = vi
      .fn<(body: TurnRequest) => Promise<AssistantTurn>>()
      .mockRejectedValueOnce(new ApiRequestError({ kind: 'network', timedOut: true }))
      .mockResolvedValueOnce(asking);
    const store = createConversationStore({ turn });
    await store.send('LaGuardia', 'en');
    expect(store.getState().failed?.failure).toEqual({ kind: 'network', timedOut: true });
    await store.retry('en');
    expect(turn).toHaveBeenCalledTimes(2);
    expect(turn.mock.calls[1]?.[0].message).toBe('LaGuardia');
    expect(store.getState().failed).toBeNull();
    expect(store.getState().entries).toHaveLength(2);
  });

  it('drops an answer that arrives after a reset', async () => {
    let answer: (turn: AssistantTurn) => void = () => undefined;
    const store = createConversationStore({
      turn: () =>
        new Promise<AssistantTurn>((resolve) => {
          answer = resolve;
        }),
    });
    const sent = store.send('LaGuardia', 'en');
    store.reset();
    answer(asking);
    await sent;
    expect(store.getState()).toEqual(emptyConversation);
  });
});
