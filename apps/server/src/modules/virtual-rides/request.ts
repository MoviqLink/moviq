import { randomUUID } from 'node:crypto';
import { toInstant, type virtualNeedSchema } from '@moviq/contracts';
import { z } from 'zod';
import type { AppBindings } from '../../infrastructure/http/context.js';
import { commerceContext } from '../commerce/context.js';
import { createNeed } from '../commerce/needs.js';
import { merchantStore, type Merchant, type MenuItem } from '../commerce/merchants.js';
import { needStore } from '../commerce/offers-store.js';
import { needView } from '../commerce/views.js';
import { shortenOffers } from './offers.js';
import { nearStop } from './suggestions.js';
import { findRide, refreshRide } from './store.js';
import { live, type VirtualRideDependencies } from './routes.js';

const invitationRow = z.object({
  id: z.string(),
  stop_id: z.string(),
  merchant_id: z.string(),
  item_id: z.string(),
  item_name: z.string(),
  price_minor: z.number(),
  created_at: z.string(),
  expires_at: z.string(),
});

export async function requestInvitation(
  deps: VirtualRideDependencies,
  owner: string,
  rideId: string,
  body: z.infer<typeof virtualNeedSchema>,
  logger: AppBindings['Variables']['logger'],
) {
  const ride = await findRide(deps.db, owner, rideId);
  if (ride === undefined || ride.state === 'ended') return null;
  const reading = await live(deps, ride.vehicle_id);
  if (reading?.tripId !== ride.trip_id) {
    await refreshRide(deps.db, ride, reading, deps.clock.now());
    return null;
  }
  const rows = await deps.db.query({
    sql: 'SELECT * FROM virtual_invitations WHERE id = ? AND ride_id = ?',
    args: [body.invitationId, rideId],
  });
  const parsed = invitationRow.safeParse(rows.rows[0]);
  if (!parsed.success || Date.parse(parsed.data.expires_at) <= deps.clock.now().getTime())
    return null;
  const inv = parsed.data;
  const existing = await deps.db.query({
    sql: 'SELECT need_id FROM virtual_ride_needs WHERE invitation_id = ?',
    args: [inv.id],
  });
  const existingId = existing.rows[0]?.['need_id'];
  if (typeof existingId === 'string') {
    const need = await needStore.find(deps.db, existingId);
    return need?.travellerId === owner ? needView(deps.commerce, need) : null;
  }
  const stop = reading.stops.find((candidate) => candidate.id === inv.stop_id);
  const merchant = await merchantStore.find(deps.db, inv.merchant_id);
  if (stop === undefined || merchant === undefined || !nearStop(merchant, stop)) return null;
  const setup = await merchantStore.setup(deps.db, merchant);
  const item = setup.menu.find(
    (entry) =>
      entry.id === inv.item_id &&
      entry.name === inv.item_name &&
      entry.priceMinor === inv.price_minor,
  );
  if (item === undefined || !setup.rules.featuredItemIds.includes(item.id)) return null;
  const at = stop.departure ?? stop.arrival;
  if (at === null || Date.parse(at) <= deps.clock.now().getTime()) return null;
  return negotiateInvitation(deps, owner, rideId, body, logger, inv, item, merchant, at);
}

async function negotiateInvitation(
  deps: VirtualRideDependencies,
  owner: string,
  rideId: string,
  body: z.infer<typeof virtualNeedSchema>,
  logger: AppBindings['Variables']['logger'],
  inv: z.infer<typeof invitationRow>,
  item: MenuItem,
  merchant: Merchant,
  at: string,
) {
  const token = randomUUID();
  const now = deps.clock.now();
  const locked = await deps.db.execute({
    sql: `UPDATE virtual_invitations SET request_token = ?, request_locked_until = ?
    WHERE id = ? AND expires_at > ? AND (request_locked_until IS NULL OR request_locked_until <= ?)`,
    args: [
      token,
      toInstant(new Date(now.getTime() + 120_000)),
      inv.id,
      toInstant(now),
      toInstant(now),
    ],
  });
  if (locked.rowsAffected !== 1) return null;
  try {
    const prior = await deps.db.query({
      sql: 'SELECT need_id FROM virtual_ride_needs WHERE invitation_id = ?',
      args: [inv.id],
    });
    const priorId = prior.rows[0]?.['need_id'];
    if (typeof priorId === 'string') {
      const need = await needStore.find(deps.db, priorId);
      return need?.travellerId === owner ? await needView(deps.commerce, need) : null;
    }
    const outcome = await createNeed(
      commerceContext(deps.commerce, logger),
      owner,
      {
        craving: item.name,
        alias: body.alias,
        taste: body.taste,
        language: body.language,
        route: { stopId: merchant.summary.stop.id },
      },
      [{ merchant, passAt: new Date(at), pickupBefore: new Date(Date.parse(at) + 30 * 60_000) }],
    );
    if (!outcome.ok) return null;
    await deps.db.transaction(async (tx) => {
      const claim = await tx.execute({
        sql: `SELECT i.id FROM virtual_invitations i JOIN virtual_rides r ON r.id = i.ride_id
          WHERE i.id = ? AND i.request_token = ? AND i.request_locked_until > ?
          AND i.expires_at > ? AND r.state = 'following'`,
        args: [inv.id, token, toInstant(deps.clock.now()), toInstant(deps.clock.now())],
      });
      if (claim.rows.length === 0) throw new Error('Invitation request expired.');
      await tx.execute({
        sql: `INSERT INTO virtual_ride_needs (ride_id, need_id, invitation_id, merchant_id, created_at)
        VALUES (?, ?, ?, ?, ?)`,
        args: [rideId, outcome.need.id, inv.id, inv.merchant_id, inv.created_at],
      });
    });
    await shortenOffers(deps.db, outcome.need.id, inv.expires_at);
    return await needView(deps.commerce, outcome.need);
  } finally {
    await deps.db.execute({
      sql: `UPDATE virtual_invitations SET request_token = NULL, request_locked_until = NULL
        WHERE id = ? AND request_token = ?`,
      args: [inv.id, token],
    });
  }
}
