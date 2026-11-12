import type { Journey, Money } from '@moviq/contracts';
import { z } from 'zod';

import type { PurchaseCatalog } from '../../payments/catalog.js';
import type { Lang } from '../planning/state.js';
import { defineTool, type AssistantTool } from '../planning/tool.js';
import { moneyText, ridesOf } from './facts.js';

/** An option of the trip Sara proposed: with a price, the one the server quoted. */
export interface Proposal {
  readonly alternativeId: string;
  readonly rides: string;
  readonly price: Money | null;
}

interface ProposeInput {
  readonly journey: Journey;
  readonly travellerId: string;
  /** Journeys' purchase catalogue: the same quote the payment will be created with. */
  readonly catalog: PurchaseCatalog;
  readonly lang: Lang;
  /** Where the proposal is kept for the screen; the last one counts. */
  readonly proposals: Proposal[];
}

/**
 * `propose_alternative`: one of the options on offer, by its number in the facts. A free one is
 * taken with "Use this route"; one with a price is quoted by the server, as the payment will be,
 * and the screen shows PayPal's button. Nothing is charged or applied here.
 */
export function proposeTool(input: ProposeInput): AssistantTool {
  const { journey, catalog, travellerId, lang, proposals } = input;
  return defineTool(
    'propose_alternative',
    'Proposes one of the options in the facts of the trip, by its number, so MovIQ shows its ' +
      'button: "Use this route" when it is free, PayPal when it has a price. The price is set ' +
      'by the server; nothing is charged or applied until the traveller approves the payment ' +
      'in PayPal and PayPal confirms it.',
    z.strictObject({ option: z.number().int().min(1).max(3) }),
    async ({ option }) => {
      const alternative = journey.alternatives[option - 1];
      if (alternative === undefined) return { error: `There is no option ${String(option)}.` };
      const rides = ridesOf(alternative.itinerary.legs);
      if (alternative.price === null) {
        proposals.push({ alternativeId: alternative.id, rides, price: null });
        return { proposed: rides, price: null, next: 'The traveller taps "Use this route".' };
      }
      const purpose = {
        kind: 'journey-alternative',
        journeyId: journey.id,
        alternativeId: alternative.id,
      } as const;
      const quote = await catalog.quote(purpose, travellerId);
      if (!quote.ok) return { error: quote.reason };
      proposals.push({ alternativeId: alternative.id, rides, price: quote.amount });
      return {
        proposed: rides,
        price: moneyText(quote.amount, lang),
        next: 'MovIQ shows the PayPal button; nothing is charged until PayPal confirms it.',
      };
    },
  );
}
