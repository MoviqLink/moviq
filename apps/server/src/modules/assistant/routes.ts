import { assistantTurnRequestSchema } from '@moviq/contracts';
import { Hono } from 'hono';

import { errorBody } from '../../infrastructure/http/errors.js';
import {
  ensureTraveller,
  type TravellerBindings,
  type TravellerSessionDependencies,
} from '../identity/traveller-sessions.js';
import type { Sara } from './sara.js';

interface AssistantRoutesDependencies {
  readonly sara: Sara;
  readonly sessions: TravellerSessionDependencies;
}

const NO_JOURNEY = 'There is no journey with that id.';

/** Only the language: Sara's words on a trip are written from the journey the server keeps. */
const explanationRequestSchema = assistantTurnRequestSchema.pick({ lang: true }).strict();

/**
 * `POST /assistant/turns`, mounted under `/api`: one message to Sara, her answer back; with a
 * `journeyId`, a question about that trip. `POST /assistant/journeys/:id/explanation`: the trip
 * with Sara's words on its latest change, written once per change.
 */
export function assistantRoutes(deps: AssistantRoutesDependencies): Hono<TravellerBindings> {
  const routes = new Hono<TravellerBindings>();
  routes.post('/assistant/turns', ensureTraveller(deps.sessions), async (c) => {
    const body = assistantTurnRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) {
      return c.json(
        errorBody(
          c,
          'bad_request',
          'Send a message of 1 to 2000 characters, its language (en or es) and the conversation ' +
            'id, or null for a new one.',
        ),
        400,
      );
    }
    const travellerId = c.var.travellerId;
    if (travellerId === undefined) throw new Error('ensureTraveller did not set a traveller');
    const { journeyId, ...turn } = body.data;
    if (journeyId === undefined || journeyId === null) {
      return c.json(await deps.sara.turn(turn, travellerId, c.var.logger, c.req.raw.signal));
    }
    const question = { ...turn, journeyId };
    const answer = await deps.sara.tripTurn(question, travellerId, c.var.logger, c.req.raw.signal);
    if (answer === undefined) return c.json(errorBody(c, 'not_found', NO_JOURNEY), 404);
    return c.json(answer);
  });
  routes.post('/assistant/journeys/:id/explanation', ensureTraveller(deps.sessions), async (c) => {
    const body = explanationRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) {
      return c.json(errorBody(c, 'bad_request', 'Send the language: en or es.'), 400);
    }
    const travellerId = c.var.travellerId;
    if (travellerId === undefined) throw new Error('ensureTraveller did not set a traveller');
    const journey = await deps.sara.explain(
      c.req.param('id'),
      travellerId,
      body.data.lang,
      c.var.logger,
    );
    if (journey === undefined) return c.json(errorBody(c, 'not_found', NO_JOURNEY), 404);
    return c.json(journey);
  });
  return routes;
}
