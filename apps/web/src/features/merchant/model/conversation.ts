import type { ConversationEntry, NeedMessage, ProtocolMessage } from '@moviq/contracts';

import { formatMoney } from '../../../shared/journey/money';
import { formatCityTime } from '../../../shared/time/city';
import type { MerchantDict } from '../texts';

type Talk = MerchantDict['conversation'];
type Who = ProtocolMessage['from'];
type Of<K extends ProtocolMessage['type']> = Extract<ProtocolMessage, { type: K }>;

/** One message of the conversation as the panel draws it on the line between the two agents. */
export interface Step {
  readonly seq: number;
  readonly at: string;
  readonly who: Who;
  /** `accepted` and `rejected` are the server's verdicts; `closed` ends the conversation. */
  readonly tone: 'plain' | 'accepted' | 'rejected' | 'closed';
  readonly title: string;
  readonly lines: readonly string[];
  /** What an agent or the server wrote in its own words (English), shown as it came. */
  readonly quoted: readonly string[];
}

/** What the panel needs to write a step: its words, the locale and the names of the menu. */
export interface StepContext {
  readonly t: Talk;
  readonly locale: string;
  readonly dishes: ReadonlyMap<string, string>;
}

type Body = Omit<Step, 'seq' | 'at' | 'who'>;

const step = (title: string, lines: string[] = [], quoted: string[] = []): Body => ({
  tone: 'plain',
  title,
  lines,
  quoted,
});

/** The traveller's preferences that touch this menu, as short tags; never anything personal. */
export function preferenceTags(preferences: NeedMessage['preferences'], t: Talk): string[] {
  const tags: string[] = [];
  if (preferences.allergies.length > 0) {
    tags.push(t.allergic(preferences.allergies.map((a) => t.allergen[a]).join(', ')));
  }
  if (preferences.avoid.length > 0) tags.push(t.without(preferences.avoid.join(', ')));
  if (preferences.noAlcohol) tags.push(t.noAlcohol);
  if (preferences.diet !== 'any') tags.push(t.diet[preferences.diet]);
  if (preferences.drink !== null) tags.push(t.drink(preferences.drink));
  return tags;
}

function need(message: Of<'need'>, { t, locale }: StepContext): Body {
  const tags = preferenceTags(message.preferences, t);
  const window = t.window(
    formatCityTime(message.pickupAfter, locale),
    formatCityTime(message.pickupBefore, locale),
  );
  return step(t.need(message.alias, message.craving), [
    t.category[message.category],
    window,
    ...(tags.length === 0 ? [t.noPreferences] : tags),
  ]);
}

function offer(message: Of<'offer'>, { t, locale, dishes }: StepContext): Body {
  const price = formatMoney({ amountMinor: message.priceMinor, currency: 'USD' }, locale);
  const lines = message.lines.map((line) => {
    const name = t.quantity(line.quantity, dishes.get(line.itemId) ?? t.item(line.itemId));
    const changes = [...line.remove.map(t.remove), ...line.add.map(t.add)];
    return changes.length === 0 ? name : `${name}, ${changes.join(', ')}`;
  });
  return step(t.offers(price, formatCityTime(message.pickupAt, locale)), lines, [message.note]);
}

function check(message: Of<'check'>, { t, locale }: StepContext): Body {
  if (message.verdict === 'accepted') {
    const reward = message.reward;
    const lines =
      reward === null ? [] : [t.reward(formatMoney(reward.earned, locale), reward.percent)];
    return { ...step(t.accepted, lines), tone: 'accepted' };
  }
  const reasons = message.refusals.map((refusal) => t.refusal[refusal.reason]);
  const quoted = message.refusals.map((refusal) => refusal.message);
  const [only] = reasons;
  const body =
    reasons.length === 1 && only !== undefined
      ? step(`${t.rejected}: ${only}`, [], quoted)
      : step(t.rejected, reasons, quoted);
  return { ...body, tone: 'rejected' };
}

type StatusName = (status: Of<'order'>['status']) => string;

function describe(message: ProtocolMessage, context: StepContext, status: StatusName): Body {
  const { t, locale } = context;
  switch (message.type) {
    case 'need':
      return need(message, context);
    case 'clarification':
      return step(t.asks, [t.options(message.options.join(' · '))], [message.question]);
    case 'answer':
      return step(t.answers(message.answer), [t.basis[message.basis]]);
    case 'offer':
      return offer(message, context);
    case 'check':
      return check(message, context);
    case 'refused-message':
      return {
        ...step(t.refusedMessage(t.who[message.of]), [], [message.reason]),
        tone: 'rejected',
      };
    case 'recommendation':
      return step(t.recommends, [], [message.reason]);
    case 'declined':
      return step(t.declined);
    case 'payment':
      return step(t.payment[message.step](formatMoney(message.amount, locale)));
    case 'order':
      return step(t.order(message.code, status(message.status)));
    case 'closed':
      return { ...step(t.closed[message.reason], [], [message.message]), tone: 'closed' };
  }
}

/**
 * The conversation in the order it was written, each message with who said it, what it means for
 * the merchant in the panel's language, and the words the agent or the server used.
 */
export function conversationSteps(
  entries: readonly ConversationEntry[],
  context: StepContext,
  orderStatus: StatusName,
): Step[] {
  return [...entries]
    .sort((a, b) => a.seq - b.seq)
    .map((entry) => ({
      seq: entry.seq,
      at: entry.at,
      who: entry.message.from,
      ...describe(entry.message, context, orderStatus),
    }));
}
