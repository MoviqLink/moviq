import { toInstant, type RoutePromotions } from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import { merchantStore } from './merchants.js';
import { isOpenAt } from './opening-hours.js';
import { merchantsOnTheWay } from './route.js';

/** Business selects featured menu items; they are suggestions, not already validated offers. */
export async function routePromotions(
  deps: { readonly db: Database; readonly clock: Clock },
  travellerId: string,
  journeyId: string,
): Promise<RoutePromotions | undefined> {
  const route = await merchantsOnTheWay(deps, travellerId, { journeyId });
  if (!route.ok) return undefined;
  const cutoff = deps.clock.now().getTime() + 3 * 60 * 60_000;
  const groups = await Promise.all(
    route.passing.map(async (passing) => {
      if (passing.passAt.getTime() > cutoff) return [];
      const setup = await merchantStore.setup(deps.db, passing.merchant);
      if (!isOpenAt(setup.hours, passing.passAt)) return [];
      return setup.menu
        .filter(
          (item) => item.category !== 'drink' && setup.rules.featuredItemIds.includes(item.id),
        )
        .map((item) => ({
          merchant: passing.merchant.summary,
          itemId: item.id,
          name: item.name,
          listPrice: { amountMinor: item.priceMinor, currency: 'USD' as const },
          passAt: toInstant(passing.passAt),
        }));
    }),
  );
  return { promotions: groups.flat() };
}
