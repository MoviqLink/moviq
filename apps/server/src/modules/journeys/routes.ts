import { randomUUID } from 'node:crypto';

import {
  createJourneyRequestSchema,
  planRequestSchema,
  toInstant,
  type Journey,
} from '@moviq/contracts';
import { Hono, type Handler } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { Clock } from '../../infrastructure/clock/clock.js';
import { pause } from '../../infrastructure/clock/pause.js';
import type { Database } from '../../infrastructure/database/database.js';
import { errorBody } from '../../infrastructure/http/errors.js';
import {
  ensureTraveller,
  readTraveller,
  type TravellerBindings,
  type TravellerSessionDependencies,
} from '../identity/traveller-sessions.js';
import { journeyStore, type StoredJourney } from './journey-store.js';
import type { JourneyPlanner } from './ports.js';
import { switchToAlternative } from './switch-alternative.js';

export interface JourneyRoutesDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly planner: JourneyPlanner;
  readonly sessions: TravellerSessionDependencies;
  /** How often the event stream looks for a new version of the journey. */
  readonly eventPollMs?: number;
}

const KEEPALIVE_MS = 15_000;

/** `/api/plan` and `/api/journeys`. A journey is visible only to the traveller who started it. */
export function journeyRoutes(deps: JourneyRoutesDependencies): Hono<TravellerBindings> {
  const routes = new Hono<TravellerBindings>();
  routes.use(readTraveller(deps.sessions));

  routes.post('/plan', ensureTraveller(deps.sessions), async (c) => {
    const body = planRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success)
      return c.json(errorBody(c, 'bad_request', 'The trip request is incomplete or invalid.'), 400);
    return c.json(await deps.planner.plan(body.data, owner(c.var.travellerId), c.req.raw.signal));
  });

  routes.post('/journeys', ensureTraveller(deps.sessions), startJourney(deps));

  routes.get('/journeys/:id', async (c) => {
    const stored = await journeyStore.get(deps.db, c.req.param('id'));
    if (!ownedBy(stored, c.var.travellerId)) {
      return c.json(errorBody(c, 'not_found', 'There is no journey with that id.'), 404);
    }
    return c.json(stored.journey);
  });

  routes.delete('/journeys/:id', ensureTraveller(deps.sessions), async (c) => {
    const id = c.req.param('id');
    const stored = await journeyStore.get(deps.db, id);
    if (!ownedBy(stored, c.var.travellerId)) {
      return c.json(errorBody(c, 'not_found', 'There is no journey with that id.'), 404);
    }
    const now = deps.clock.now();
    const done = await deps.db.transaction(async (tx) => {
      const updated = await journeyStore.update(
        tx,
        id,
        stored.version,
        { state: 'cancelled' },
        now,
      );
      if (updated) await journeyStore.addEvent(tx, id, 'cancelled', {}, now);
      return updated;
    });
    if (!done)
      return c.json(errorBody(c, 'conflict', 'The journey changed meanwhile. Reload it.'), 409);
    return c.body(null, 204);
  });

  routes.get('/journeys/:id/events', journeyEvents(deps));
  routes.post(
    '/journeys/:id/alternatives/:alternativeId/apply',
    ensureTraveller(deps.sessions),
    applyAlternative(deps),
  );

  return routes;
}

function startJourney(deps: JourneyRoutesDependencies): Handler<TravellerBindings> {
  return async (c) => {
    const body = createJourneyRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success)
      return c.json(errorBody(c, 'bad_request', 'Choose an itinerary of a plan.'), 400);
    const travellerId = owner(c.var.travellerId);
    const now = deps.clock.now();
    const plan = await journeyStore.findPlan(deps.db, body.data.planId, travellerId, now);
    const itinerary = plan?.response.itineraries.find(
      (candidate) => candidate.id === body.data.itineraryId,
    );
    if (plan === undefined || itinerary === undefined) {
      return c.json(
        errorBody(c, 'not_found', 'That plan has expired or does not exist. Plan the trip again.'),
        404,
      );
    }
    const journey: Journey = {
      id: randomUUID(),
      state: 'watching',
      request: plan.request,
      itinerary,
      createdAt: toInstant(now),
      watch: {
        status: 'unknown',
        evaluatedAt: null,
        projectedArriveAt: null,
        evidence: 'Not checked yet.',
        flight: null,
        stepFreeRefusal: null,
      },
      incidents: [],
      alternatives: [],
    };
    await journeyStore.create(deps.db, journey, travellerId, now);
    return c.json(journey, 201);
  };
}

/**
 * Takes a free alternative: the journey switches to it at once. One with a price is refused with
 * 409, because only a payment PayPal confirmed may apply it.
 */
function applyAlternative(
  deps: JourneyRoutesDependencies,
): Handler<TravellerBindings, '/journeys/:id/alternatives/:alternativeId/apply'> {
  return async (c) => {
    const stored = await journeyStore.get(deps.db, c.req.param('id'));
    const alternative = stored?.journey.alternatives.find(
      (candidate) => candidate.id === c.req.param('alternativeId'),
    );
    if (!ownedBy(stored, c.var.travellerId) || alternative === undefined) {
      return c.json(errorBody(c, 'not_found', 'That alternative is no longer on offer.'), 404);
    }
    if (stored.journey.state !== 'watching') {
      return c.json(errorBody(c, 'conflict', 'This journey is no longer being watched.'), 409);
    }
    if (alternative.price !== null) {
      return c.json(
        errorBody(c, 'conflict', 'This alternative costs money: pay for it first.'),
        409,
      );
    }
    const switched = await deps.db.transaction((tx) =>
      switchToAlternative(
        tx,
        stored,
        alternative,
        {
          event: 'alternative-chosen',
          detail: {},
          evidence: 'Switched to the alternative you chose.',
        },
        deps.clock.now(),
      ),
    );
    if (!switched)
      return c.json(errorBody(c, 'conflict', 'The journey changed meanwhile. Reload it.'), 409);
    const latest = await journeyStore.get(deps.db, stored.journey.id);
    if (latest === undefined)
      return c.json(errorBody(c, 'not_found', 'There is no journey with that id.'), 404);
    return c.json(latest.journey);
  };
}

function journeyEvents(
  deps: JourneyRoutesDependencies,
): Handler<TravellerBindings, '/journeys/:id/events'> {
  return async (c) => {
    const id = c.req.param('id');
    const first = await journeyStore.get(deps.db, id);
    if (!ownedBy(first, c.var.travellerId)) {
      return c.json(errorBody(c, 'not_found', 'There is no journey with that id.'), 404);
    }
    const signal = c.req.raw.signal;
    return streamSSE(c, async (stream) => {
      let sent = first.version;
      let quietSince = Date.now();
      // Unnamed events, so `EventSource.onmessage` gets every version of the journey.
      await stream.writeSSE({ data: JSON.stringify(first.journey), id: String(first.version) });
      while (!signal.aborted && !stream.aborted) {
        await pause(deps.eventPollMs ?? 2_000, signal);
        const version = await journeyStore.version(deps.db, id);
        if (version !== undefined && version !== sent) {
          const latest = await journeyStore.get(deps.db, id);
          if (latest !== undefined) {
            await stream.writeSSE({
              data: JSON.stringify(latest.journey),
              id: String(latest.version),
            });
            sent = latest.version;
            quietSince = Date.now();
          }
        } else if (Date.now() - quietSince >= KEEPALIVE_MS) {
          // A comment keeps proxies from closing a quiet stream and is ignored by the browser.
          await stream.write(': keepalive\n\n');
          quietSince = Date.now();
        }
      }
    });
  };
}

/** Journeys belong to the traveller who started them; anyone else gets a 404. */
function ownedBy(
  stored: StoredJourney | undefined,
  travellerId: string | undefined,
): stored is StoredJourney {
  return stored !== undefined && travellerId !== undefined && stored.travellerId === travellerId;
}

/** After `ensureTraveller` the id is always present. */
function owner(travellerId: string | undefined): string {
  if (travellerId === undefined) throw new Error('ensureTraveller must run before this handler');
  return travellerId;
}
