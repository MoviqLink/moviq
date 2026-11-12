import { randomUUID } from 'node:crypto';
import {
  agentCreateSchema,
  agentTurnRequestSchema,
  watchCreateSchema,
  watchUpdateSchema,
  toInstant,
} from '@moviq/contracts';
import { Hono } from 'hono';
import { errorBody } from '../../infrastructure/http/errors.js';
import {
  ensureTraveller,
  type TravellerBindings,
  type TravellerSessionDependencies,
} from '../identity/traveller-sessions.js';
import { scrubPersonalData } from '../assistant/privacy.js';
import { conversationStore } from '../assistant/conversations.js';
import { routeOf } from '../assistant/city/lines.js';
import type { Sara } from '../assistant/sara.js';
import type { SourceReader } from '../data-platform/reader.js';
import { findRoad, readRoads } from './roads.js';
import {
  createAgent,
  detail,
  ensurePrimary,
  listAgents,
  clearConversation,
  ownedAgent,
  saveTurn,
  lockTurn,
  unlockTurn,
} from './store.js';

interface WorkspaceDependencies {
  readonly sessions: TravellerSessionDependencies;
  readonly sara: Sara;
  readonly reader: SourceReader;
}
const travellerOf = (value: string | undefined): string => {
  if (value === undefined) throw new Error('Missing traveller');
  return value;
};

function registerAgents(routes: Hono<TravellerBindings>, deps: WorkspaceDependencies): void {
  const { db, clock } = deps.sessions;
  routes.get('/', async (c) => c.json(await listAgents(db, travellerOf(c.var.travellerId))));
  routes.post('/', async (c) => {
    const body = agentCreateSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json(errorBody(c, 'bad_request', 'Give the agent a name.'), 400);
    if (!(await createAgent(db, travellerOf(c.var.travellerId), body.data.name, clock.now())))
      return c.json(errorBody(c, 'conflict', 'At most two additional agents.'), 409);
    return c.json(await listAgents(db, travellerOf(c.var.travellerId)), 201);
  });
  routes.get('/roads', async (c) =>
    c.json(await readRoads(deps.reader, clock.now(), c.req.query('q') ?? '')),
  );
  routes.get('/:id', async (c) => {
    const found = await detail(db, travellerOf(c.var.travellerId), c.req.param('id'));
    return found === undefined
      ? c.json(errorBody(c, 'not_found', 'Agent not found.'), 404)
      : c.json(found);
  });
  routes.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const traveller = travellerOf(c.var.travellerId);
    const result = await db.transaction(async (tx) => {
      const own = await tx.execute({
        sql: 'SELECT id FROM workspace_agents WHERE id = ? AND traveller_id = ? AND is_primary = 0',
        args: [id, traveller],
      });
      if (own.rows.length === 0) return 0;
      const busy = await tx.execute({
        sql: 'SELECT id FROM workspace_agents WHERE id = ? AND turn_locked_until > ?',
        args: [id, toInstant(clock.now())],
      });
      if (busy.rows.length > 0) return -1;
      await tx.execute({
        sql: `DELETE FROM assistant_conversations WHERE traveller_id = ? AND id IN (SELECT conversation_id
          FROM workspace_agents WHERE id = ?)`,
        args: [traveller, id],
      });
      await tx.execute({ sql: 'DELETE FROM workspace_messages WHERE agent_id = ?', args: [id] });
      await tx.execute({ sql: 'DELETE FROM workspace_watches WHERE agent_id = ?', args: [id] });
      return (
        await tx.execute({
          sql: 'DELETE FROM workspace_agents WHERE id = ? AND traveller_id = ?',
          args: [id, traveller],
        })
      ).rowsAffected;
    });
    if (result === -1)
      return c.json(errorBody(c, 'conflict', 'Wait for the active turn to finish.'), 409);
    return result === 0
      ? c.json(errorBody(c, 'not_found', 'Agent not found.'), 404)
      : c.body(null, 204);
  });
}
function registerTurns(routes: Hono<TravellerBindings>, deps: WorkspaceDependencies): void {
  const { db, clock } = deps.sessions;
  routes.delete('/:id/messages', async (c) => {
    const traveller = travellerOf(c.var.travellerId);
    const id = c.req.param('id');
    if (!(await clearConversation(db, traveller, id)))
      return c.json(errorBody(c, 'not_found', 'Agent not found.'), 404);
    return c.json(await detail(db, traveller, id));
  });
  routes.post('/:id/turns', async (c) => {
    const body = agentTurnRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success)
      return c.json(errorBody(c, 'bad_request', 'Give a message and language.'), 400);
    const traveller = travellerOf(c.var.travellerId);
    const id = c.req.param('id');
    const token = await lockTurn(db, traveller, id, clock.now());
    if (token === null)
      return c.json(errorBody(c, 'conflict', 'Agent unavailable or another turn is running.'), 409);
    try {
      const agent = await ownedAgent(db, traveller, id);
      if (agent === undefined) return c.json(errorBody(c, 'not_found', 'Agent not found.'), 404);
      const text = scrubPersonalData(body.data.message);
      // Each turn works on a private copy: an expired turn cannot overwrite a later turn's draft.
      const prior =
        agent.conversation_id === null
          ? undefined
          : await conversationStore.load(db, agent.conversation_id, traveller, clock.now());
      const copyId = prior === undefined ? null : randomUUID();
      if (prior !== undefined && copyId !== null)
        await conversationStore.save(db, copyId, traveller, prior, clock.now());
      let answer;
      try {
        answer = await deps.sara.turn(
          { message: text, lang: body.data.lang, conversationId: copyId },
          traveller,
          c.var.logger,
          c.req.raw.signal,
        );
      } catch (error) {
        if (copyId !== null)
          await db.execute({
            sql: 'DELETE FROM assistant_conversations WHERE id = ? AND traveller_id = ?',
            args: [copyId, traveller],
          });
        throw error;
      }
      if (!(await saveTurn(db, traveller, id, token, text, answer, clock.now()))) {
        await db.execute({
          sql: 'DELETE FROM assistant_conversations WHERE id = ? AND traveller_id = ?',
          args: [answer.conversationId, traveller],
        });
        return c.json(errorBody(c, 'conflict', 'The turn expired.'), 409);
      }
      if (agent.conversation_id !== null)
        await db.execute({
          sql: 'DELETE FROM assistant_conversations WHERE id = ? AND traveller_id = ?',
          args: [agent.conversation_id, traveller],
        });
      return c.json(answer);
    } finally {
      await unlockTurn(db, id, token);
    }
  });
}
function registerWatches(routes: Hono<TravellerBindings>, deps: WorkspaceDependencies): void {
  const { db, clock } = deps.sessions;
  routes.post('/:id/watches', async (c) => {
    const body = watchCreateSchema.safeParse(await c.req.json().catch(() => undefined));
    const route = body.success && body.data.kind === 'line' ? routeOf(body.data.line) : undefined;
    if (!body.success || (body.data.kind === 'line' && route === undefined))
      return c.json(errorBody(c, 'bad_request', 'Give a supported subway, bus or PATH line.'), 400);
    const road =
      body.data.kind === 'street' &&
      body.data.segmentId !== undefined &&
      body.data.thresholdKmh !== undefined
        ? await findRoad(deps.reader, clock.now(), body.data.segmentId)
        : undefined;
    if (body.data.kind === 'street' && road === undefined)
      return c.json(
        errorBody(
          c,
          'bad_request',
          'Choose a current measured road segment and a speed threshold.',
        ),
        400,
      );
    const owner = await ownedAgent(db, travellerOf(c.var.travellerId), c.req.param('id'));
    if (owner === undefined) return c.json(errorBody(c, 'not_found', 'Agent not found.'), 404);
    const added = await db.execute({
      sql: `INSERT INTO workspace_watches (id, agent_id, line, kind, status, created_at, segment_id,
        threshold_kmh) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspace_agents
        WHERE id = ? AND traveller_id = ?) AND (SELECT count(*) FROM workspace_watches WHERE agent_id
        = ?) < 10`,
      args: [
        randomUUID(),
        owner.id,
        road?.name ?? route?.label ?? body.data.line,
        body.data.kind,
        'waiting',
        toInstant(clock.now()),
        road?.id ?? null,
        body.data.kind === 'street' ? (body.data.thresholdKmh ?? null) : null,
        owner.id,
        travellerOf(c.var.travellerId),
        owner.id,
      ],
    });
    if (added.rowsAffected === 0)
      return c.json(errorBody(c, 'conflict', 'At most ten watches per agent.'), 409);
    return c.json(await detail(db, travellerOf(c.var.travellerId), owner.id), 201);
  });
  routes.put('/:id/watches/:watchId', async (c) => {
    const body = watchUpdateSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json(errorBody(c, 'bad_request', 'Give paused as a boolean.'), 400);
    const result = await db.execute({
      sql: `UPDATE workspace_watches SET status = ?, generation = generation + 1, checked_at = NULL,
        source = NULL, saw_alert = 0, consecutive = 0, measured_at = NULL, speed_kmh = NULL WHERE id =
        ? AND agent_id IN (SELECT id FROM workspace_agents WHERE id = ? AND traveller_id = ?)`,
      args: [
        body.data.paused ? 'paused' : 'waiting',
        c.req.param('watchId'),
        c.req.param('id'),
        travellerOf(c.var.travellerId),
      ],
    });
    return result.rowsAffected === 0
      ? c.json(errorBody(c, 'not_found', 'Watch not found.'), 404)
      : c.json(await detail(db, travellerOf(c.var.travellerId), c.req.param('id')));
  });
  routes.delete('/:id/watches/:watchId', async (c) => {
    const result = await db.execute({
      sql: `DELETE FROM workspace_watches WHERE id = ? AND agent_id IN (SELECT id FROM workspace_agents
        WHERE id = ? AND traveller_id = ?)`,
      args: [c.req.param('watchId'), c.req.param('id'), travellerOf(c.var.travellerId)],
    });
    return result.rowsAffected === 0
      ? c.json(errorBody(c, 'not_found', 'Watch not found.'), 404)
      : c.body(null, 204);
  });
}
export function agentWorkspaceRoutes(deps: WorkspaceDependencies): Hono<TravellerBindings> {
  const routes = new Hono<TravellerBindings>();
  const { db, clock } = deps.sessions;
  routes.use('*', ensureTraveller(deps.sessions));
  routes.use('*', async (c, next) => {
    await ensurePrimary(db, travellerOf(c.var.travellerId), clock.now());
    await next();
  });
  registerAgents(routes, deps);
  registerTurns(routes, deps);
  registerWatches(routes, deps);
  return routes;
}
