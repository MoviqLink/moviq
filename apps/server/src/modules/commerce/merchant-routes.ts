import {
  agentTalkRequestSchema,
  agentUpdateSchema,
  type agentSetupSchema,
  type customerListSchema,
  type merchantListSchema,
  type merchantSessionSchema,
  type payoutBoardSchema,
  type requestListSchema,
  type savedRulesSchema,
  type scanAnswerSchema,
  type ScanRefusal,
  type ScanRefusalReason,
  type statusChangeSchema,
  type ticketListSchema,
  type MerchantSummary,
} from '@moviq/contracts';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import type { AppBindings } from '../../infrastructure/http/context.js';
import { errorBody } from '../../infrastructure/http/errors.js';
import { payoutLedger } from '../payments/payouts/payout-ledger.js';
import { previewAgent } from './agent-preview.js';
import { talkToAgent } from './agent-talk.js';
import { holdContext, paymentsReason, type CommerceDependencies } from './context.js';
import {
  kitchenTickets,
  merchantCustomers,
  merchantRequests,
  merchantToday,
} from './merchant-board.js';
import {
  closeMerchantSession,
  requireMerchant,
  sessionMerchant,
  type MerchantBindings,
} from './merchant-sessions.js';
import { merchantLogin } from './merchant-login.js';
import { merchantStore } from './merchants.js';
import { ORDER_TRANSITIONS, orderStore } from './orders-store.js';
import { merchantBalance, payNow, payoutContext, payoutView } from './payouts.js';
import { refundMissing, scanCode } from './pickup.js';
import { updateRules } from './rules-update.js';

const statusSchema = z.strictObject({ status: z.enum(['preparing', 'ready']) });
const scanSchema = z.strictObject({ code: z.string().min(1).max(200) });
const refundSchema = z.strictObject({
  lines: z.array(z.number().int().min(0).max(9)).min(1).max(4),
});
type M = Context<MerchantBindings>;
type Body<S extends z.ZodType> = z.infer<S>;
type Panel = Hono<MerchantBindings>;

/**
 * The merchant's panel, mounted under `/api/merchant`, on a demo session per merchant: today,
 * requests with the conversation between agents, kitchen tickets, scanning the pickup code
 * (which charges), customers by alias, payouts and the rules of "Your agent".
 */
export function merchantRoutes(deps: CommerceDependencies): Hono<AppBindings> {
  const open = new Hono<AppBindings>();
  open.get('/merchants', async (c) => {
    const merchants = (await merchantStore.all(deps.db)).map((m) => m.summary);
    return c.json({ merchants } satisfies Body<typeof merchantListSchema>);
  });
  open.route('/', merchantLogin(deps));
  open.get('/session', async (c) => {
    const id = await sessionMerchant(c, deps);
    const merchant = id === undefined ? undefined : await merchantStore.find(deps.db, id);
    return c.json(session(merchant?.summary));
  });
  open.delete('/session', async (c) => {
    await closeMerchantSession(c, deps);
    return c.json(session(undefined));
  });
  const panel: Panel = new Hono<MerchantBindings>();
  panel.use(requireMerchant(deps));
  boardRoutes(panel, deps);
  counterRoutes(panel, deps);
  moneyRoutes(panel, deps);
  agentRoutes(panel, deps);
  open.route('/', panel);
  return open;
}

/** Today, requests with their conversation, and customers by alias. */
function boardRoutes(panel: Panel, deps: CommerceDependencies): void {
  panel.get('/today', async (c) => c.json(await merchantToday(deps, await merchantOf(c, deps))));
  panel.get('/requests', async (c) => {
    const requests = await merchantRequests(deps, c.var.merchantId);
    return c.json({ requests } satisfies Body<typeof requestListSchema>);
  });
  panel.get('/requests/:threadId', async (c) => {
    const all = await merchantRequests(deps, c.var.merchantId);
    const found = all.find((request) => request.threadId === c.req.param('threadId'));
    return found === undefined
      ? c.json(errorBody(c, 'forbidden', 'This request is not yours.'), 403)
      : c.json(found);
  });
  panel.get('/customers', async (c) => {
    const customers = await merchantCustomers(deps, c.var.merchantId);
    return c.json({ customers } satisfies Body<typeof customerListSchema>);
  });
}

/** Kitchen tickets, the scan that charges, and refunds of missing lines. */
function counterRoutes(panel: Panel, deps: CommerceDependencies): void {
  panel.get('/tickets', async (c) => {
    const tickets = await kitchenTickets(deps, c.var.merchantId);
    return c.json({ tickets } satisfies Body<typeof ticketListSchema>);
  });
  panel.post('/tickets/:orderId/status', async (c) => {
    const parsed = statusSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return bad(c, 'Send preparing or ready; the pickup is by scanning.');
    const order = await orderStore.find(deps.db, c.req.param('orderId'));
    if (order?.merchantId !== c.var.merchantId) return notYours(c);
    const to = parsed.data.status;
    const moved = ORDER_TRANSITIONS[order.status].includes(to)
      ? await deps.db.transaction((tx) => orderStore.move(tx, order, to, deps.clock.now()))
      : undefined;
    if (moved === undefined) {
      return c.json(
        errorBody(c, 'conflict', `Order ${order.code} cannot go from ${order.status} to ${to}.`),
        409,
      );
    }
    return c.json({
      orderId: moved.id,
      status: moved.status,
    } satisfies Body<typeof statusChangeSchema>);
  });
  panel.post('/scan', async (c) => {
    const parsed = scanSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return bad(c, 'Send the scanned code.');
    const ctx = holdContext(deps, c.var.logger);
    if (ctx === undefined) {
      return c.json(scanRefusal(c, 409, 'payments-off', paymentsReason(deps)), 409);
    }
    const secret = deps.settings.codeSecret;
    const outcome = await scanCode(ctx, {
      merchantId: c.var.merchantId,
      code: parsed.data.code,
      secret,
    });
    if (outcome.kind === 'refused') {
      return c.json(
        scanRefusal(c, outcome.status, outcome.reason, outcome.message),
        outcome.status,
      );
    }
    const body = {
      orderId: outcome.order.id,
      code: outcome.order.code,
      status: outcome.order.status,
    };
    return outcome.kind === 'charged'
      ? c.json({ ...body, charged: outcome.amount } satisfies Body<typeof scanAnswerSchema>)
      : c.json({ ...body, message: outcome.message } satisfies Body<typeof scanAnswerSchema>, 202);
  });
  panel.post('/orders/:orderId/refunds', async (c) => {
    const parsed = refundSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return bad(c, 'Send the numbers of the missing lines.');
    const order = await orderStore.find(deps.db, c.req.param('orderId'));
    if (order?.merchantId !== c.var.merchantId) return notYours(c);
    const ctx = holdContext(deps, c.var.logger);
    if (ctx === undefined) return c.json(errorBody(c, 'conflict', paymentsReason(deps)), 409);
    const outcome = await refundMissing(ctx, order, parsed.data.lines);
    if (!outcome.ok) return c.json(errorBody(c, 'conflict', outcome.message), 409);
    return c.json(outcome, outcome.pending.amountMinor > 0 ? 202 : 200);
  });
}

/** Payouts: the account (fixed for demo merchants), the batches, and "get paid now". */
function moneyRoutes(panel: Panel, deps: CommerceDependencies): void {
  panel.get('/payouts', async (c) => {
    const merchant = await merchantOf(c, deps);
    const batches = await payoutLedger.forMerchant(deps.db, merchant.summary.id);
    return c.json({
      receiver: merchant.payoutReceiver,
      available: deps.payouts !== undefined,
      refundsToDeduct: await merchantBalance(deps, merchant),
      batches: batches.map(payoutView),
    } satisfies Body<typeof payoutBoardSchema>);
  });
  panel.post('/payouts/now', async (c) => {
    const ctx = payoutContext(deps, c.var.logger);
    if (ctx === undefined) return c.json(errorBody(c, 'conflict', paymentsReason(deps)), 409);
    const outcome = await payNow(ctx, await merchantOf(c, deps));
    if (outcome.ok) return c.json(payoutView(outcome.batch), 201);
    return c.json(errorBody(c, 'conflict', outcome.message), 409);
  });
  panel.put('/payout-account', (c) =>
    c.json(errorBody(c, 'forbidden', 'A demo merchant cannot change where its payouts go.'), 403),
  );
}

/**
 * "Your agent": its rules and opening hours, the program's minimum reward, the menu it composes
 * from, a preview of what its rules compose now, saved nowhere, and the talk with the agent,
 * whose proposals are saved only through `PUT /agent`.
 */
function agentRoutes(panel: Panel, deps: CommerceDependencies): void {
  panel.get('/agent', async (c) => {
    const setup = await merchantStore.setup(deps.db, await merchantOf(c, deps));
    return c.json({
      rules: setup.rules,
      version: setup.rulesVersion,
      minRewardPercent: deps.settings.minRewardPercent,
      hours: setup.hours,
      menu: setup.menu.map((item) => ({
        id: item.id,
        name: item.name,
        priceMinor: item.priceMinor,
        ingredients: item.ingredients.map((i) => ({ ...i, allergens: [...i.allergens] })),
        extras: item.extras.map((e) => ({ ...e, allergens: [...e.allergens] })),
      })),
      talk: deps.talk !== undefined,
    } satisfies Body<typeof agentSetupSchema>);
  });
  panel.get('/agent/preview', async (c) => {
    const setup = await merchantStore.setup(deps.db, await merchantOf(c, deps));
    return c.json(await previewAgent(deps, setup));
  });
  panel.post('/agent/talk', async (c) => {
    const parsed = agentTalkRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return bad(c, 'Send a message of up to 400 characters and its language.');
    return c.json(await talkToAgent(deps, await merchantOf(c, deps), parsed.data));
  });
  panel.put('/agent', async (c) => {
    const parsed = agentUpdateSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return bad(c, 'Send the rules, the hours and the version you read.');
    const outcome = await updateRules(deps, await merchantOf(c, deps), parsed.data);
    return outcome.ok
      ? c.json(outcome.saved satisfies Body<typeof savedRulesSchema>)
      : c.json(errorBody(c, 'conflict', outcome.message), 409);
  });
}

function session(merchant: MerchantSummary | undefined): Body<typeof merchantSessionSchema> {
  return merchant === undefined ? { signedIn: false } : { signedIn: true, merchant };
}

/** A refused scan: the usual error body, with the code of its reason for the panel. */
function scanRefusal(
  c: M,
  status: 403 | 404 | 409,
  reason: ScanRefusalReason,
  message: string,
): ScanRefusal {
  const code = status === 403 ? 'forbidden' : status === 404 ? 'not_found' : 'conflict';
  return { error: { ...errorBody(c, code, message).error, reason } };
}

async function merchantOf(c: M, deps: CommerceDependencies) {
  const merchant = await merchantStore.find(deps.db, c.var.merchantId);
  if (merchant === undefined) throw new Error(`Merchant ${c.var.merchantId} is gone.`);
  return merchant;
}

const bad = (c: M, message: string) => c.json(errorBody(c, 'bad_request', message), 400);
const notYours = (c: M) => c.json(errorBody(c, 'forbidden', 'This order is not yours.'), 403);
