import type { Money } from '@moviq/contracts';
import { z } from 'zod';

import { MAX_TICKETS } from '../../tickets/autopay.js';
import { productOf, ticketCatalog } from '../../tickets/catalog.js';
import type { ActionAnswer } from './actions.js';
import type { Turn } from './state.js';
import { legAfterStop } from './stopover.js';
import type { TicketRefusal } from './ticket-words.js';
import { defineTool, type AssistantTool } from './tool.js';

/** The fare an itinerary states is the MTA's: it is paid with this many single rides. */
const TRIP_PRODUCT = 'omny-single-demo';

function dollars(amount: Money): string {
  return `$${(amount.amountMinor / 100).toFixed(2)}`;
}

/** Every product as the model reads it: its id, what it is, who runs it and its price. */
const PRODUCT_LIST = ticketCatalog()
  .products.map(
    (product) => `${product.id} (${product.name}, ${product.operator}, ${dollars(product.price)})`,
  )
  .join('; ');

/** Records why nothing was bought; the reply tells it with its fixed words. */
function refuse(turn: Turn, reason: TicketRefusal): ActionAnswer {
  turn.tickets = { kind: 'refused', reason };
  return { bought: [], refused: reason, charged: 'nothing' };
}

const FERRY_PRODUCT = 'nyc-ferry-single-demo';
/** Express buses have their own fare: BM, BxM, QM, SIM and X routes, as the MTA names them. */
const EXPRESS_BUS = /^(BM|BXM|QM|SIM|X)\d/i;

type TripLeg = NonNullable<Turn['state']['plan']>['itineraries'][number]['legs'][number];

/**
 * The tickets the rides of a trip need when the planner stated no fare, by the MTA's own rules:
 * one single ride pays the subway until the traveller leaves it, and the first change to or
 * from a local bus within two hours is free. Rail, taxis and express buses are left unpriced.
 */
function ticketsOfLegs(legs: readonly TripLeg[]): readonly string[] | undefined {
  const tickets: string[] = [];
  let previous: TripLeg['mode'] | undefined;
  let freeTransferUsed = false;
  for (const leg of legs) {
    if (leg.mode === 'walk') continue;
    if (leg.mode === 'ferry') {
      tickets.push(FERRY_PRODUCT);
    } else if (leg.mode === 'subway' || leg.mode === 'bus') {
      if (leg.mode === 'bus' && EXPRESS_BUS.test(leg.route?.shortName ?? '')) return undefined;
      const insideSubway = previous === 'subway' && leg.mode === 'subway';
      const freeChange =
        !insideSubway && (previous === 'subway' || previous === 'bus') && !freeTransferUsed;
      if (freeChange) freeTransferUsed = true;
      if (!insideSubway && !freeChange) tickets.push(TRIP_PRODUCT);
    } else {
      return undefined;
    }
    previous = leg.mode;
  }
  return tickets;
}

/** The tickets the planned trip needs, or why they cannot be told. */
function tripTickets(turn: Turn): readonly string[] | TicketRefusal {
  const plan = turn.state.plan;
  const best = plan?.itineraries.find((itinerary) => itinerary.id === plan.recommendedId);
  if (best === undefined) return 'no-plan';
  const single = productOf(TRIP_PRODUCT)?.price.amountMinor;
  const fare = best.fare?.amount.amountMinor;
  if (single !== undefined && fare !== undefined && fare > 0 && fare % single === 0) {
    return Array.from({ length: fare / single }, () => TRIP_PRODUCT);
  }
  // Through a stop the traveller leaves the system: each part is paid as its own ride.
  const stop = turn.state.stop ?? null;
  const after = stop === null ? undefined : legAfterStop(best.legs, stop);
  const parts =
    after === undefined ? [best.legs] : [best.legs.slice(0, after), best.legs.slice(after)];
  const tickets: string[] = [];
  for (const part of parts) {
    const needed = ticketsOfLegs(part);
    if (needed === undefined) return 'no-fare';
    tickets.push(...needed);
  }
  // A trip on foot needs no ticket: there is nothing to buy.
  return tickets.length === 0 ? 'no-fare' : tickets;
}

/**
 * The assistant buys tickets on its own: the server sets every price from the catalogue and
 * charges the PayPal agreement the traveller approved once. Nothing is bought without it.
 */
export const ticketTools: readonly AssistantTool[] = [
  defineTool(
    'buy_tickets',
    'Buys transit tickets for the traveller and pays them with the PayPal they connected, with ' +
      'no further approval. With for_trip true it buys what the planned trip needs, from its ' +
      'verified fare, and items is empty. Otherwise items lists products and quantities. ' +
      `Products: ${PRODUCT_LIST}.`,
    z.strictObject({
      for_trip: z.boolean(),
      items: z
        .array(
          z.strictObject({
            product: z.string().min(1).max(60),
            quantity: z.number().int().min(1).max(MAX_TICKETS),
          }),
        )
        .max(MAX_TICKETS),
    }),
    async (input, ports, turn) => {
      if (ports.tickets === undefined) return refuse(turn, 'unavailable');
      const asked = input.for_trip
        ? tripTickets(turn)
        : input.items.flatMap((item) => Array.from({ length: item.quantity }, () => item.product));
      if (typeof asked === 'string') return refuse(turn, asked);
      if (asked.length === 0) return refuse(turn, 'nothing-asked');
      const purchase = await ports.tickets.buy(turn.travellerId, asked, ports.logger);
      if (!purchase.ok) return refuse(turn, purchase.reason);
      turn.tickets = { kind: 'bought', receipts: purchase.receipts };
      return {
        paidWith: 'PayPal',
        bought: purchase.receipts
          .filter((receipt) => receipt.bought)
          .map((receipt) => ({
            ticket: receipt.product.name,
            price: dollars(receipt.product.price),
          })),
        notBought: purchase.receipts
          .filter((receipt) => !receipt.bought)
          .map((receipt) => receipt.product.name),
      };
    },
  ),
];
