import { randomUUID } from 'node:crypto';
import { toInstant, type VirtualRide } from '@moviq/contracts';
import { z } from 'zod';
import type { CommerceDependencies } from '../commerce/context.js';
import { merchantStore, type Merchant, type MenuItem } from '../commerce/merchants.js';
import { isOpenAt } from '../commerce/opening-hours.js';
import type { PlacedStop } from '../live/estimate.js';
import type { RideRow } from './store.js';

const RADIUS = 450;
export const nearStop = (merchant: Merchant, stop: { lat: number; lon: number }) => {
  const rad = Math.PI / 180;
  const dx =
    (merchant.summary.lon - stop.lon) *
    rad *
    Math.cos(((merchant.summary.lat + stop.lat) / 2) * rad);
  const dy = (merchant.summary.lat - stop.lat) * rad;
  return Math.hypot(dx, dy) * 6_371_000 <= RADIUS;
};
type Suggestion = VirtualRide['stops'][number]['suggestions'][number];
const invitation = z.object({
  id: z.string(),
  expires_at: z.string(),
  item_name: z.string(),
  price_minor: z.number(),
});

async function suggestion(
  deps: CommerceDependencies,
  row: RideRow,
  stop: PlacedStop,
  merchant: Merchant,
  item: MenuItem,
): Promise<Suggestion | null> {
  const now = deps.clock.now();
  await deps.db.execute({
    sql: `INSERT OR IGNORE INTO virtual_invitations
    (id, ride_id, stop_id, merchant_id, item_id, item_name, price_minor, created_at, expires_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS
    (SELECT 1 FROM virtual_rides WHERE id = ? AND traveller_id = ? AND state = 'following')
    AND (SELECT COUNT(*) FROM virtual_invitations WHERE ride_id = ?) < 32`,
    args: [
      randomUUID(),
      row.id,
      stop.id,
      merchant.summary.id,
      item.id,
      item.name,
      item.priceMinor,
      toInstant(now),
      toInstant(new Date(now.getTime() + 300_000)),
      row.id,
      row.traveller_id,
      row.id,
    ],
  });
  const result = await deps.db.query({
    sql: `SELECT id, expires_at, item_name, price_minor
    FROM virtual_invitations WHERE ride_id = ? AND stop_id = ? AND merchant_id = ? AND item_id = ?`,
    args: [row.id, stop.id, merchant.summary.id, item.id],
  });
  const parsed = invitation.safeParse(result.rows[0]);
  if (
    !parsed.success ||
    parsed.data.item_name !== item.name ||
    parsed.data.price_minor !== item.priceMinor
  )
    return null;
  return {
    invitationId: parsed.data.id,
    expiresAt: parsed.data.expires_at,
    status: Date.parse(parsed.data.expires_at) <= now.getTime() ? 'expired' : 'offered',
    merchant: merchant.summary,
    itemId: item.id,
    name: item.name,
    listPrice: { amountMinor: item.priceMinor, currency: 'USD' },
  };
}

/** Published stops only; GET composes deterministic previews without calling the agent. */
export async function suggestionsFor(
  deps: CommerceDependencies,
  row: RideRow,
  stops: readonly PlacedStop[],
) {
  const merchants = await merchantStore.all(deps.db);
  return Promise.all(
    stops.map(async (stop) => {
      const at = stop.departure ?? stop.arrival;
      const groups = await Promise.all(
        merchants
          .filter((merchant) => nearStop(merchant, stop))
          .map(async (merchant) => {
            const setup = await merchantStore.setup(deps.db, merchant);
            if (
              at === null ||
              Date.parse(at) <= deps.clock.now().getTime() ||
              !isOpenAt(setup.hours, new Date(at))
            )
              return [];
            const selected = setup.menu.filter(
              (item) => item.category !== 'drink' && setup.rules.featuredItemIds.includes(item.id),
            );
            const result = await Promise.all(
              selected.map((item) => suggestion(deps, row, stop, merchant, item)),
            );
            return result.filter((item) => item !== null);
          }),
      );
      return { ...stop, suggestions: groups.flat() };
    }),
  );
}
