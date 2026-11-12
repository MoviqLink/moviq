import { merchantMessageSchema, toInstant, type AgentPreview, type Taste } from '@moviq/contracts';

import type { CommerceDependencies } from './context.js';
import type { MerchantAgentSetup } from './merchants.js';
import { buildNeed } from './need.js';
import { checkOffer } from './offer-check.js';
import { orderStore } from './orders-store.js';
import { composeByRules } from './rules-agent.js';
import { lineViews } from './views.js';

type PreviewCase = AgentPreview['cases'][number];

const MINUTE = 60_000;
/** The pickup window of an example need, from now: as long as a traveller's trip allows. */
const WINDOW_MINUTES = 60;

const noTaste: Taste = {
  allergies: [],
  avoid: [],
  noAlcohol: false,
  diet: 'any',
  drink: null,
  spice: null,
};

/** Three example customers; the menu keeps only the preferences it can touch, as for Sara. */
const EXAMPLES: readonly (Pick<PreviewCase, 'example' | 'alias'> & { readonly taste: Taste })[] = [
  { example: 'no-preferences', alias: 'Mia', taste: noTaste },
  {
    example: 'vegetarian',
    alias: 'Leo',
    taste: { ...noTaste, diet: 'vegetarian', noAlcohol: true },
  },
  {
    example: 'allergies',
    alias: 'Ana',
    taste: { ...noTaste, allergies: ['peanuts', 'milk', 'sesame'], avoid: ['onion', 'scallions'] },
  },
];

/** What a customer would ask this merchant for: its first featured dish, or its first one. */
function cravingFor(setup: MerchantAgentSetup): string {
  const dishes = setup.menu.filter((item) => item.category !== 'drink');
  const first = dishes.find((item) => setup.rules.featuredItemIds.includes(item.id)) ?? dishes[0];
  return first?.keywords[0] ?? first?.name ?? 'something';
}

/**
 * "Your agent", F-J9-09: what the agent's rules compose right now for three example customers,
 * and what the server's check says of each. Nothing is saved, and the language model is never
 * used, so the preview costs nothing and shows the rules as they are.
 */
export async function previewAgent(
  deps: Pick<CommerceDependencies, 'db' | 'clock' | 'settings'>,
  setup: MerchantAgentSetup,
): Promise<AgentPreview> {
  const now = deps.clock.now();
  const earliestPickup = new Date(now.getTime() + setup.rules.prepMinutes * MINUTE);
  const craving = cravingFor(setup);
  const cases = await Promise.all(
    EXAMPLES.map(async ({ example, alias, taste }): Promise<PreviewCase> => {
      const need = buildNeed({
        alias,
        craving,
        taste,
        menu: setup.menu,
        window: { after: now, before: new Date(now.getTime() + WINDOW_MINUTES * MINUTE) },
      });
      const turn = {
        need,
        setup,
        history: [],
        minRewardPercent: deps.settings.minRewardPercent,
        earliestPickup,
        clarificationsLeft: 0,
      };
      const parsed = merchantMessageSchema.safeParse(composeByRules(turn).message);
      const base = { example, alias, craving, preferences: need.preferences };
      if (!parsed.success || parsed.data.type !== 'offer') {
        return { ...base, outcome: { kind: 'nothing' } };
      }
      const offer = parsed.data;
      const check = checkOffer({
        ...turn,
        offer,
        ordersInSlot: await orderStore.inSlot(
          deps.db,
          setup.merchant.summary.id,
          new Date(offer.pickupAt),
        ),
      });
      const shown = {
        lines: lineViews(setup.menu, offer.lines),
        note: offer.note,
        pickupAt: offer.pickupAt,
      };
      return check.ok
        ? { ...base, outcome: { kind: 'accepted', ...shown, reward: check.reward } }
        : { ...base, outcome: { kind: 'rejected', ...shown, refusals: [...check.refusals] } };
    }),
  );
  return { composer: 'rules', composedAt: toInstant(now), cases };
}
