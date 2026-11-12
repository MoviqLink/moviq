import type { MerchantMessage, NeedMessage, OfferRefusal, Reward } from '@moviq/contracts';

import { allergensOf, type MenuItem, type MerchantAgentSetup } from './merchants.js';
import { isOpenAt } from './opening-hours.js';

export type OfferMessage = Extract<MerchantMessage, { type: 'offer' }>;

export interface OfferCheckInput {
  readonly offer: OfferMessage;
  readonly need: NeedMessage;
  readonly setup: MerchantAgentSetup;
  /** The program's rule: every offer at least this much cheaper than the menu. */
  readonly minRewardPercent: number;
  /** Orders already booked in the quarter hour of the pickup. */
  readonly ordersInSlot: number;
  /** Now plus the kitchen's preparation time. */
  readonly earliestPickup: Date;
}

interface Refusal {
  readonly reason: OfferRefusal;
  readonly message: string;
}

export type OfferCheck =
  | { readonly ok: true; readonly reward: Reward; readonly listMinor: number }
  | { readonly ok: false; readonly refusals: readonly Refusal[] };

/** The demo cost of an extra, as a share of its price; items carry their own cost. */
const EXTRA_COST_PERCENT = 40;

/**
 * The server's check of an offer composed by a merchant's agent. Prices are recomputed from the
 * menu, never taken from the agent; an offer passes only if it is at least the program's
 * minimum reward cheaper than the menu, within the agent's maximum discount and minimum margin,
 * within capacity and opening hours, and safe for the traveller's allergies and preferences.
 */
export function checkOffer(input: OfferCheckInput): OfferCheck {
  const refusals: Refusal[] = [];
  const lines = input.offer.lines.map((line) => ({
    line,
    item: input.setup.menu.find((item) => item.id === line.itemId),
  }));
  for (const { line, item } of lines) {
    if (item === undefined)
      refusals.push(refuse('unknown-item', `${line.itemId} is not on the menu.`));
    else refusals.push(...checkLine(item, line, input.need));
  }
  const priced = lines.flatMap(({ line, item }) => (item === undefined ? [] : [{ line, item }]));
  if (priced.length === lines.length) refusals.push(...checkPrice(input, priced));
  refusals.push(...checkSlot(input));
  if (refusals.length > 0) return { ok: false, refusals };
  const listMinor = listPrice(priced);
  const earned = listMinor - input.offer.priceMinor;
  return {
    ok: true,
    listMinor,
    reward: {
      listPrice: { amountMinor: listMinor, currency: 'USD' },
      price: { amountMinor: input.offer.priceMinor, currency: 'USD' },
      earned: { amountMinor: earned, currency: 'USD' },
      percent: Math.floor((earned * 100) / listMinor),
    },
  };
}

type Line = OfferMessage['lines'][number];

function checkLine(item: MenuItem, line: Line, need: NeedMessage): Refusal[] {
  const refusals: Refusal[] = [];
  const removable = item.ingredients.filter((i) => i.removable).map((i) => i.name);
  const addable = item.extras.map((extra) => extra.name);
  const notAllowed = [
    ...line.remove.filter((name) => !removable.includes(name)),
    ...line.add.filter((name) => !addable.includes(name)),
  ];
  if (notAllowed.length > 0) {
    refusals.push(
      refuse(
        'change-not-allowed',
        `The kitchen cannot change ${notAllowed.join(', ')} in ${item.name}.`,
      ),
    );
  }
  const allergens = allergensOf(item, line.remove, line.add);
  const unsafe = need.preferences.allergies.filter((allergen) => allergens.has(allergen));
  if (unsafe.length > 0)
    refusals.push(refuse('allergen', `${item.name} would contain ${unsafe.join(', ')}.`));
  const kept = [
    ...item.ingredients.filter((i) => !line.remove.includes(i.name)).map((i) => i.name),
    ...line.add,
  ];
  const avoided = need.preferences.avoid.filter((word) =>
    kept.some((name) => name.toLowerCase().includes(word.toLowerCase())),
  );
  if (avoided.length > 0) {
    refusals.push(
      refuse('avoided-ingredient', `${item.name} would still have ${avoided.join(', ')}.`),
    );
  }
  if (item.alcohol && need.preferences.noAlcohol) {
    refusals.push(refuse('alcohol', `${item.name} has alcohol and the traveller does not drink.`));
  }
  if (!dietAllows(need.preferences.diet, item.diet)) {
    refusals.push(refuse('diet', `${item.name} is not ${need.preferences.diet}.`));
  }
  return refusals;
}

function dietAllows(wanted: NeedMessage['preferences']['diet'], item: MenuItem['diet']): boolean {
  if (wanted === 'vegan') return item === 'vegan';
  if (wanted === 'vegetarian') return item !== 'any';
  return true;
}

function checkPrice(
  input: OfferCheckInput,
  priced: readonly { line: Line; item: MenuItem }[],
): Refusal[] {
  const list = listPrice(priced);
  const cost = priced.reduce((sum, { line, item }) => {
    const extras = extrasPrice(item, line) * EXTRA_COST_PERCENT;
    return sum + (item.costMinor * 100 + extras) * line.quantity;
  }, 0);
  const price = input.offer.priceMinor;
  const discount = list - price;
  const rules = input.setup.rules;
  const refusals: Refusal[] = [];
  if (discount * 100 < input.minRewardPercent * list) {
    refusals.push(
      refuse(
        'reward-below-program',
        `Rejected: MovIQ requires every offer to be at least ${String(input.minRewardPercent)}% below the menu price.`,
      ),
    );
  }
  if (discount * 100 > rules.maxDiscountPercent * list) {
    refusals.push(
      refuse(
        'discount-above-maximum',
        `Rejected: above your agent's maximum discount of ${String(rules.maxDiscountPercent)}%.`,
      ),
    );
  }
  if (price * 100 * 100 < cost * (100 + rules.minMarginPercent)) {
    refusals.push(
      refuse(
        'below-margin',
        `Rejected: below your agent's minimum margin of ${String(rules.minMarginPercent)}%.`,
      ),
    );
  }
  return refusals;
}

function checkSlot(input: OfferCheckInput): Refusal[] {
  const refusals: Refusal[] = [];
  const pickupAt = new Date(input.offer.pickupAt);
  if (input.ordersInSlot >= input.setup.rules.ordersPerQuarterHour) {
    refusals.push(refuse('no-capacity', 'The kitchen is full for that quarter hour.'));
  }
  const after = Math.max(
    input.earliestPickup.getTime(),
    new Date(input.need.pickupAfter).getTime(),
  );
  if (
    pickupAt.getTime() < after ||
    pickupAt.getTime() > new Date(input.need.pickupBefore).getTime()
  ) {
    refusals.push(
      refuse('too-late', 'The pickup time is outside what the kitchen and the trip allow.'),
    );
  }
  if (!isOpenAt(input.setup.hours, pickupAt)) {
    refusals.push(refuse('closed', 'The merchant is closed at that time.'));
  }
  return refusals;
}

export function listPrice(priced: readonly { line: Line; item: MenuItem }[]): number {
  return priced.reduce(
    (sum, { line, item }) => sum + (item.priceMinor + extrasPrice(item, line)) * line.quantity,
    0,
  );
}

function extrasPrice(item: MenuItem, line: Line): number {
  return item.extras
    .filter((extra) => line.add.includes(extra.name))
    .reduce((sum, extra) => sum + extra.priceMinor, 0);
}

const refuse = (reason: OfferRefusal, message: string): Refusal => ({ reason, message });
