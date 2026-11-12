import {
  toInstant,
  type MerchantMessage,
  type NeedMessage,
  type ProtocolMessage,
} from '@moviq/contracts';

import type { AgentReply, AgentTurn, MerchantAgent } from './agent.js';
import { allergensOf, type MenuItem } from './merchants.js';
import { itemsFor, normalise } from './need.js';
import { listPrice } from './offer-check.js';

type Line = Extract<MerchantMessage, { type: 'offer' }>['lines'][number];

const SPICY_EXTRA = 'chili oil';
const QUARTER_HOUR_MS = 15 * 60_000;

/**
 * The honest deterministic agent: it composes from the merchant's rules alone, for this need. It
 * leaves out what the traveller cannot or will not have when the kitchen allows it, adds their
 * drink when the menu has it, asks once about spice when a dish offers chili, and prices the
 * offer inside the program's minimum reward, the maximum discount and the minimum margin.
 */
export const rulesAgent: MerchantAgent = {
  respond: (turn) => Promise.resolve(composeByRules(turn)),
};

export function composeByRules(turn: AgentTurn): AgentReply {
  const reply = (message: unknown): AgentReply => ({ message, composer: 'rules' });
  const { need, setup } = turn;
  const featured = setup.rules.featuredItemIds;
  const candidates = [...itemsFor(need.craving, setup.menu)].sort(
    (a, b) => Number(featured.includes(b.id)) - Number(featured.includes(a.id)),
  );
  const spice = answerTo(turn.history, 'spice');
  for (const item of candidates) {
    const line = safeLine(item, need);
    const drink = drinkLine(setup.menu, need);
    if (
      line === undefined ||
      priceFor(turn, drink === undefined ? [line] : [line, drink]) === undefined
    )
      continue;
    const spicy = item.extras.some((extra) => extra.name === SPICY_EXTRA);
    if (spicy && spice === undefined && turn.clarificationsLeft > 0) {
      return reply({
        type: 'clarification',
        from: 'merchant-agent',
        topic: 'spice',
        question: `Mild or hot for the ${item.name}?`,
        options: ['mild', 'hot'],
      });
    }
    const lines = [spice === 'hot' && spicy ? { ...line, add: [...line.add, SPICY_EXTRA] } : line];
    if (drink !== undefined) lines.push(drink);
    const price = priceFor(turn, lines);
    if (price === undefined) continue;
    return reply({
      type: 'offer',
      from: 'merchant-agent',
      lines,
      priceMinor: price,
      pickupAt: toInstant(pickupTime(turn)),
      note: noteFor(lines, setup.menu),
    });
  }
  return reply(null);
}

/** The item as this traveller can have it, or undefined when the kitchen cannot make it so. */
function safeLine(item: MenuItem, need: NeedMessage): Line | undefined {
  const prefs = need.preferences;
  if (item.alcohol && prefs.noAlcohol) return undefined;
  if (prefs.diet === 'vegan' && item.diet !== 'vegan') return undefined;
  if (prefs.diet === 'vegetarian' && item.diet === 'any') return undefined;
  const unwanted = (name: string, allergens: readonly string[]) =>
    allergens.some((allergen) => prefs.allergies.some((a) => a === allergen)) ||
    prefs.avoid.some((word) => normalise(name).includes(normalise(word)));
  const remove = item.ingredients.filter((i) => unwanted(i.name, i.allergens)).map((i) => i.name);
  const blocked = item.ingredients.some((i) => remove.includes(i.name) && !i.removable);
  if (blocked) return undefined;
  const left = allergensOf(item, remove, []);
  if (prefs.allergies.some((allergen) => left.has(allergen))) return undefined;
  return { itemId: item.id, quantity: 1, remove, add: [] };
}

function drinkLine(menu: readonly MenuItem[], need: NeedMessage): Line | undefined {
  const wanted = need.preferences.drink;
  if (wanted === null) return undefined;
  const drink = menu.find(
    (item) => item.category === 'drink' && normalise(item.name).includes(normalise(wanted)),
  );
  return drink === undefined ? undefined : safeLine(drink, need);
}

/** The lowest discount above the program's minimum that keeps the agent's margin. */
function priceFor(turn: AgentTurn, lines: readonly Line[]): number | undefined {
  const priced = lines.flatMap((line) => {
    const item = turn.setup.menu.find((candidate) => candidate.id === line.itemId);
    return item === undefined ? [] : [{ line, item }];
  });
  const list = listPrice(priced);
  const { maxDiscountPercent, minMarginPercent } = turn.setup.rules;
  if (maxDiscountPercent < turn.minRewardPercent) return undefined;
  const target = Math.min(maxDiscountPercent, turn.minRewardPercent + 5);
  const cost = priced.reduce(
    (sum, { line, item }) => sum + item.costMinor * line.quantity * 100 + extras(item, line) * 40,
    0,
  );
  const floor = Math.ceil((cost * (100 + minMarginPercent)) / 10_000);
  // Rounded up, so the discount never passes the target: the agent's maximum stays a maximum.
  const price = Math.max(Math.ceil((list * (100 - target)) / 100), floor);
  return (list - price) * 100 >= turn.minRewardPercent * list ? price : undefined;
}

function extras(item: MenuItem, line: Line): number {
  return item.extras
    .filter((e) => line.add.includes(e.name))
    .reduce((sum, e) => sum + e.priceMinor * line.quantity, 0);
}

/** The earliest time allowed, a quarter hour later for each time the kitchen was full. */
function pickupTime(turn: AgentTurn): Date {
  const full = turn.history.filter(
    (message) =>
      message.type === 'check' && message.refusals.some((r) => r.reason === 'no-capacity'),
  ).length;
  const earliest = Math.max(
    turn.earliestPickup.getTime(),
    new Date(turn.need.pickupAfter).getTime(),
  );
  const minute = 60_000;
  return new Date(Math.ceil((earliest + full * QUARTER_HOUR_MS) / minute) * minute);
}

function answerTo(history: readonly ProtocolMessage[], topic: 'spice'): string | undefined {
  const answer = history.findLast(
    (message) => message.type === 'answer' && message.topic === topic,
  );
  return answer?.type === 'answer' ? answer.answer : undefined;
}

function noteFor(lines: readonly Line[], menu: readonly MenuItem[]): string {
  const parts = lines.flatMap((line) => {
    const name = menu.find((item) => item.id === line.itemId)?.name ?? line.itemId;
    const changes = [
      ...line.remove.map((r) => `without ${r}`),
      ...line.add.map((a) => `with ${a}`),
    ];
    return changes.length === 0 ? [name] : [`${name}, ${changes.join(', ')}`];
  });
  return `Made for you: ${parts.join(' + ')}.`.slice(0, 200);
}
