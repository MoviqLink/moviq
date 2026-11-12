import type { NeedView, OrderView, RewardOffer } from '@moviq/contracts';

import type { RewardsDict } from '../texts';

/** A question a merchant's agent asks the traveller, in their language, with the answers sent as is. */
export interface Question {
  readonly threadId: string;
  readonly text: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

/** The offers still worth showing, Sara's recommendation first, then the largest reward. */
export function offersOf(need: NeedView): readonly RewardOffer[] {
  return need.offers
    .filter((offer) => offer.status !== 'declined')
    .sort(
      (a, b) =>
        Number(b.recommended) - Number(a.recommended) ||
        b.reward.earned.amountMinor - a.reward.earned.amountMinor,
    );
}

const SPICE = /^Mild or hot for the (.+)\?$/;

/** The questions waiting for the traveller, the known ones in their language. */
export function questionsOf(need: NeedView, t: RewardsDict['question']): readonly Question[] {
  return need.threads.flatMap((thread) => {
    const { question } = thread;
    if (thread.status !== 'awaiting-traveller' || question === null) return [];
    const dish = question.topic === 'spice' ? SPICE.exec(question.text)?.[1] : undefined;
    return [
      {
        threadId: thread.id,
        text: dish === undefined ? question.text : t.spice(dish),
        options: question.options.map((value) => ({ value, label: t.options[value] ?? value })),
      },
    ];
  });
}

/** What to say when no offer came: nobody could make it, or the questions ran out. */
export function noOfferText(need: NeedView, t: RewardsDict['offers']): string | null {
  if (need.offers.length > 0 || need.threads.some((thread) => thread.status !== 'closed')) {
    return need.message === null ? null : t.none;
  }
  const exhausted = need.threads.some((thread) =>
    thread.conversation.some(
      (entry) =>
        entry.message.type === 'closed' && entry.message.reason === 'clarifications-exhausted',
    ),
  );
  return exhausted ? t.closed : t.none;
}

/** "without scallions, with chili oil" as the server writes it, in the reader's language. */
export function changesText(changes: string, lang: 'en' | 'es'): string {
  if (lang === 'en' || changes === '') return changes;
  return changes
    .split(', ')
    .map((part) => part.replace(/^without /, 'sin ').replace(/^with /, 'con '))
    .join(', ');
}

/** Free cancellation is the server's word: only while it says so and the order is still reserved. */
export const canCancel = (order: OrderView): boolean =>
  order.freeCancellation && order.status === 'reserved';

/** The orders still to collect first, then the rest, each group by pickup time. */
export function ordersInOrder(orders: readonly OrderView[]): readonly OrderView[] {
  const done = (order: OrderView) => order.status === 'picked_up' || order.status === 'cancelled';
  return [...orders].sort(
    (a, b) => Number(done(a)) - Number(done(b)) || a.pickupAt.localeCompare(b.pickupAt),
  );
}
