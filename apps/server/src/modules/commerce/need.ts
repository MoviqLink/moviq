import { toInstant, type NeedMessage, type Taste } from '@moviq/contracts';

import { allergensOf, type MenuItem } from './merchants.js';

type Category = NeedMessage['category'];

const CATEGORY_WORDS: readonly (readonly [Category, readonly string[]])[] = [
  ['coffee', ['coffee', 'cafe', 'latte', 'espresso', 'cappuccino', 'cold brew']],
  ['goods', ['umbrella', 'paraguas', 'charger', 'cargador', 'water', 'agua', 'battery', 'bateria']],
  ['snack', ['snack', 'merienda', 'pastry', 'croissant', 'bolleria', 'fries', 'patatas', 'gyoza']],
];

/** Lower case without accents, so "café" and "cafe", "batería" and "bateria" match. */
export function normalise(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** What kind of thing the traveller asks for; anything else is a meal ("I'm hungry", "ramen"). */
function categoryOf(craving: string): Category {
  const words = normalise(craving);
  return (
    CATEGORY_WORDS.find(([, list]) => list.some((word) => words.includes(word)))?.[0] ?? 'meal'
  );
}

/** The menu items a craving asks for: by keyword, or every item of its category when none names one. */
export function itemsFor(craving: string, menu: readonly MenuItem[]): readonly MenuItem[] {
  const words = normalise(craving);
  const category = categoryOf(craving);
  const named = menu.filter(
    (item) =>
      item.category !== 'drink' &&
      (normalise(item.name) === words ||
        item.keywords.some((keyword) => words.includes(normalise(keyword)))),
  );
  if (named.length > 0) return named;
  const generic =
    category === 'meal' && /hungry|hambre|comer|eat|food|comida|lunch|dinner|cena/.test(words);
  return generic ? menu.filter((item) => item.category === 'meal') : [];
}

/**
 * Sara's first message to a merchant's agent. It carries the alias, the craving, the window and
 * only the preferences this menu can touch: an allergy none of its items has, a dislike none of
 * its ingredients matches or a drink it does not sell is left out. Nothing else of the traveller
 * leaves: no name, contact, exact place or journey.
 */
export function buildNeed(input: {
  readonly alias: string;
  readonly craving: string;
  readonly taste: Taste;
  readonly menu: readonly MenuItem[];
  readonly window: { readonly after: Date; readonly before: Date };
}): NeedMessage {
  const { taste, menu } = input;
  const menuAllergens = new Set(
    menu.flatMap((item) => [
      ...allergensOf(
        item,
        [],
        item.extras.map((e) => e.name),
      ),
    ]),
  );
  const names = menu.flatMap((item) => [
    ...item.ingredients.map((i) => i.name),
    ...item.extras.map((e) => e.name),
  ]);
  const drinks = menu.filter((item) => item.category === 'drink' || item.category === 'coffee');
  return {
    type: 'need',
    from: 'sara',
    alias: input.alias,
    craving: input.craving,
    category: categoryOf(input.craving),
    pickupAfter: toInstant(input.window.after),
    pickupBefore: toInstant(input.window.before),
    preferences: {
      allergies: taste.allergies.filter((allergen) => menuAllergens.has(allergen)),
      avoid: taste.avoid.filter((word) =>
        names.some((name) => normalise(name).includes(normalise(word))),
      ),
      noAlcohol: taste.noAlcohol && menu.some((item) => item.alcohol),
      diet: taste.diet,
      drink:
        taste.drink !== null &&
        drinks.some((item) => normalise(item.name).includes(normalise(taste.drink ?? '')))
          ? taste.drink
          : null,
    },
  };
}
