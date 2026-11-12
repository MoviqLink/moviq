import type { VirtualRide } from '@moviq/contracts';
import type { Database } from '../../infrastructure/database/database.js';
import { needStore } from '../commerce/offers-store.js';
import { orderStore } from '../commerce/orders-store.js';
import { needView, orderView } from '../commerce/views.js';
import type { CommerceDependencies } from '../commerce/context.js';
import { parseSnapshot, type RideRow } from './store.js';
import { suggestionsFor } from './suggestions.js';

export async function rideView(deps: CommerceDependencies, row: RideRow): Promise<VirtualRide> {
  const snapshot = parseSnapshot(row);
  const stops = row.state === 'following' ? await suggestionsFor(deps, row, snapshot.stops) : [];
  const links = await deps.db.query({
    sql: `SELECT need_id FROM virtual_ride_needs WHERE ride_id = ? ORDER BY created_at DESC LIMIT 20`,
    args: [row.id],
  });
  const needs = [];
  const orders = [];
  for (const link of links.rows) {
    const id = link['need_id'];
    if (typeof id !== 'string') continue;
    const need = await needStore.find(deps.db, id);
    if (need?.travellerId !== row.traveller_id) continue;
    const view = await needView(deps, need);
    needs.push(view);
    for (const offer of view.offers) {
      const result = await deps.db.query({
        sql: 'SELECT id FROM commerce_orders WHERE offer_id = ? AND traveller_id = ?',
        args: [offer.id, row.traveller_id],
      });
      const orderId = result.rows[0]?.['id'];
      if (typeof orderId !== 'string') continue;
      const order = await orderStore.find(deps.db, orderId);
      if (order !== undefined) {
        const found = await orderView(
          { db: deps.db, clock: deps.clock, secret: deps.settings.codeSecret },
          order,
        );
        if (found !== undefined) orders.push({ offerId: offer.id, order: found });
      }
    }
  }
  return {
    id: row.id,
    status: row.state,
    vehicle: snapshot.vehicle,
    sources: snapshot.sources,
    stops,
    updatedAt: row.updated_at,
    journeyId: row.journey_id,
    needs,
    orders,
  };
}
export async function shortenOffers(
  db: Database,
  needId: string,
  expiresAt: string,
): Promise<void> {
  await db.execute({
    sql: `UPDATE commerce_offers SET expires_at = MIN(expires_at, ?)
    WHERE thread_id IN (SELECT id FROM commerce_threads WHERE need_id = ?) AND status = 'open'`,
    args: [expiresAt, needId],
  });
}
