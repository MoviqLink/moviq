import { z } from 'zod';

import { moneySchema } from './money.js';
import { instantSchema } from './time.js';

/**
 * Commerce on the way: the traveller's need, the typed protocol between Sara and each merchant's
 * agent, the offers the server validated, the orders they become and the merchant's panel. Every
 * merchant is a demo (`demo: true`); every amount is set by the server in integer cents.
 */

/** The nine major food allergens of US law (FALCPA and the FASTER Act). */
export const allergenSchema = z.enum([
  'milk',
  'eggs',
  'fish',
  'shellfish',
  'tree-nuts',
  'peanuts',
  'wheat',
  'soy',
  'sesame',
]);

export type Allergen = z.infer<typeof allergenSchema>;

const dietSchema = z.enum(['any', 'vegetarian', 'vegan']);

/** What the traveller wants: a meal, a coffee, a snack or something from a shop. */
const needCategorySchema = z.enum(['meal', 'coffee', 'snack', 'goods']);

const ingredientName = z.string().min(1).max(40);
const alias = z
  .string()
  .regex(/^[\p{L}][\p{L} .'-]{0,23}$/u, { error: 'an alias is 1 to 24 letters' });

/** The traveller's tastes as the web keeps them. Only what matters for a menu ever leaves them. */
export const tasteSchema = z.strictObject({
  allergies: z.array(allergenSchema).max(9),
  avoid: z.array(ingredientName).max(20),
  noAlcohol: z.boolean(),
  diet: dietSchema,
  drink: ingredientName.nullable(),
  spice: z.enum(['mild', 'hot']).nullable(),
});

export type Taste = z.infer<typeof tasteSchema>;

/** `POST /api/commerce/needs`: "I'm hungry", "a coffee", "ramen tonight". */
export const needRequestSchema = z.strictObject({
  craving: z.string().trim().min(2).max(80),
  alias,
  taste: tasteSchema,
  /** The journey whose route the merchants must be on, or one stop the traveller passes. */
  route: z.union([
    z.strictObject({ journeyId: z.string().min(1) }),
    /** `at`: when the traveller will pass the stop; now when left out. */
    z.strictObject({ stopId: z.string().regex(/^\d{3,9}$/), at: instantSchema.optional() }),
  ]),
  language: z.enum(['en', 'es']),
});

export type NeedRequest = z.infer<typeof needRequestSchema>;

const cents = z.number().int().nonnegative();
const shortText = z.string().min(1).max(200);

/** One line of an offer: an item of the menu, with only the changes its kitchen allows. */
export const offerLineSchema = z.strictObject({
  itemId: z.string().min(1).max(60),
  quantity: z.number().int().min(1).max(4),
  remove: z.array(ingredientName).max(6),
  add: z.array(ingredientName).max(4),
});

export type OfferLine = z.infer<typeof offerLineSchema>;

/** Why the server refused an offer. The merchant's agent must compose another one. */
export const offerRefusalSchema = z.enum([
  'unknown-item',
  'change-not-allowed',
  'allergen',
  'avoided-ingredient',
  'alcohol',
  'diet',
  'reward-below-program',
  'discount-above-maximum',
  'below-margin',
  'no-capacity',
  'closed',
  'too-late',
]);

export type OfferRefusal = z.infer<typeof offerRefusalSchema>;

/** The reward: the menu price, what the traveller pays, and the difference they earn. */
export const rewardSchema = z.strictObject({
  listPrice: moneySchema,
  price: moneySchema,
  earned: moneySchema,
  percent: z.number().int().min(0).max(100),
});

export type Reward = z.infer<typeof rewardSchema>;

/**
 * The protocol between agents, message by message. Each is strict: an unknown type, a field
 * more or a price written as text is refused, recorded with its reason, and never adapted.
 */
export const needMessageSchema = z.strictObject({
  type: z.literal('need'),
  from: z.literal('sara'),
  alias,
  craving: z.string().min(2).max(80),
  category: needCategorySchema,
  pickupAfter: instantSchema,
  pickupBefore: instantSchema,
  /** Only the preferences this menu can touch: never a name, contact or exact location. */
  preferences: tasteSchema.omit({ spice: true }),
});

export type NeedMessage = z.infer<typeof needMessageSchema>;

const clarificationTopicSchema = z.enum(['spice', 'drink', 'size']);

export const merchantMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('clarification'),
    from: z.literal('merchant-agent'),
    topic: clarificationTopicSchema,
    question: shortText,
    options: z.array(z.string().min(1).max(40)).min(2).max(4),
  }),
  z.strictObject({
    type: z.literal('offer'),
    from: z.literal('merchant-agent'),
    lines: z.array(offerLineSchema).min(1).max(4),
    priceMinor: cents,
    pickupAt: instantSchema,
    /** Why it was made for this traveller, in one sentence. */
    note: shortText,
  }),
]);

export type MerchantMessage = z.infer<typeof merchantMessageSchema>;

const serverMessages = [
  z.strictObject({
    type: z.literal('check'),
    from: z.literal('server'),
    verdict: z.enum(['accepted', 'rejected']),
    refusals: z.array(z.strictObject({ reason: offerRefusalSchema, message: shortText })),
    reward: rewardSchema.nullable(),
  }),
  /** A message from an agent that did not fit its schema: why, never its content. */
  z.strictObject({
    type: z.literal('refused-message'),
    from: z.literal('server'),
    of: z.enum(['sara', 'merchant-agent']),
    reason: shortText,
  }),
  z.strictObject({
    type: z.literal('payment'),
    from: z.literal('server'),
    step: z.enum(['authorized', 'voided', 'captured', 'refunded', 'not-applied']),
    amount: moneySchema,
  }),
  z.strictObject({
    type: z.literal('order'),
    from: z.literal('server'),
    code: z.string().regex(/^[A-Z]-\d{4}$/),
    status: z.enum(['reserved', 'preparing', 'ready', 'picked_up', 'cancelled']),
  }),
  z.strictObject({
    type: z.literal('closed'),
    from: z.literal('server'),
    reason: z.enum(['no-valid-offer', 'clarifications-exhausted', 'expired', 'unavailable']),
    message: shortText,
  }),
] as const;

const saraMessages = [
  needMessageSchema,
  z.strictObject({
    type: z.literal('answer'),
    from: z.literal('sara'),
    topic: clarificationTopicSchema,
    answer: z.string().min(1).max(40),
    basis: z.enum(['profile', 'traveller']),
  }),
  z.strictObject({
    type: z.literal('recommendation'),
    from: z.literal('sara'),
    offerId: z.string().min(1),
    reason: shortText,
  }),
  z.strictObject({ type: z.literal('declined'), from: z.literal('sara'), offerId: z.string() }),
] as const;

export const protocolMessageSchema = z.discriminatedUnion('type', [
  ...saraMessages,
  ...merchantMessageSchema.options,
  ...serverMessages,
]);

export type ProtocolMessage = z.infer<typeof protocolMessageSchema>;

/** A message as both panels read it, in the order it was written. */
export const conversationEntrySchema = z.object({
  seq: z.number().int().positive(),
  at: instantSchema,
  message: protocolMessageSchema,
});

export type ConversationEntry = z.infer<typeof conversationEntrySchema>;

export const merchantSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['restaurant', 'cafe', 'shop']),
  demo: z.literal(true),
  stop: z.object({ id: z.string(), name: z.string(), routes: z.array(z.string()) }),
  walkMinutes: z.number().int().positive(),
  lat: z.number(),
  lon: z.number(),
});

export type MerchantSummary = z.infer<typeof merchantSummarySchema>;

/** An offer validated by the server, as the traveller sees it ("Move and earn"). */
export const rewardOfferSchema = z.object({
  id: z.string().min(1),
  merchant: merchantSummarySchema,
  lines: z.array(z.object({ name: z.string(), quantity: z.number().int(), changes: z.string() })),
  reward: rewardSchema,
  pickupAt: instantSchema,
  /** Minutes the stop adds to the trip: walking there and back. */
  detourMinutes: z.number().int().nonnegative(),
  note: z.string(),
  composer: z.enum(['model', 'rules']),
  recommended: z.boolean(),
  status: z.enum(['open', 'declined', 'reserved', 'expired']),
  expiresAt: instantSchema,
});

export type RewardOffer = z.infer<typeof rewardOfferSchema>;

const threadSchema = z.object({
  id: z.string().min(1),
  merchantId: z.string().min(1),
  status: z.enum(['negotiating', 'awaiting-traveller', 'offered', 'closed']),
  /** The question the traveller must answer while `awaiting-traveller`. */
  question: z
    .object({ topic: clarificationTopicSchema, text: z.string(), options: z.array(z.string()) })
    .nullable(),
  conversation: z.array(conversationEntrySchema),
});

/** `POST /api/commerce/needs` and `GET /api/commerce/needs/:id`. */
export const needViewSchema = z.object({
  id: z.string().min(1),
  craving: z.string(),
  createdAt: instantSchema,
  offers: z.array(rewardOfferSchema),
  threads: z.array(threadSchema),
  /** Said plainly when no merchant on the way can make it now. */
  message: z.string().nullable(),
});

export type NeedView = z.infer<typeof needViewSchema>;

const orderStatusSchema = z.enum(['reserved', 'preparing', 'ready', 'picked_up', 'cancelled']);

export type OrderStatus = z.infer<typeof orderStatusSchema>;

/** What a hold on the traveller's PayPal means for the order. */
const orderPaymentSchema = z.object({
  holdId: z.string().min(1),
  status: z.enum(['unknown', 'created', 'authorized', 'captured', 'voided', 'failed']),
  authorized: moneySchema,
  captured: moneySchema,
  /** Given back: PayPal confirmed it. */
  refunded: moneySchema,
  /** Asked for and not confirmed by PayPal yet; it moves to `refunded` once PayPal confirms it. */
  refundPending: moneySchema.default({ amountMinor: 0, currency: 'USD' }),
});

export const orderViewSchema = z.object({
  id: z.string().min(1),
  code: z.string().regex(/^[A-Z]-\d{4}$/),
  merchant: merchantSummarySchema,
  status: orderStatusSchema,
  lines: z.array(z.object({ name: z.string(), quantity: z.number().int(), changes: z.string() })),
  reward: rewardSchema,
  pickupAt: instantSchema,
  kitchenStartsAt: instantSchema,
  /** True while cancelling is free: before the kitchen starts. */
  freeCancellation: z.boolean(),
  payment: orderPaymentSchema,
  /** The signed pickup code to show as a QR while the order can be collected. */
  pickup: z.object({ qr: z.string().min(1), expiresAt: instantSchema }).nullable(),
});

export type OrderView = z.infer<typeof orderViewSchema>;

/** `POST /api/commerce/offers/:id/reserve`: what the PayPal button needs. */
export const reservationSchema = z.object({
  holdId: z.string().min(1),
  paypalOrderId: z.string().min(1),
  amount: moneySchema,
  status: orderPaymentSchema.shape.status,
});

export type Reservation = z.infer<typeof reservationSchema>;

/** The merchant's agent: what it may do on its own. Edited in "Your agent". */
export const agentRulesSchema = z.strictObject({
  maxDiscountPercent: z.number().int().min(0).max(60),
  minMarginPercent: z.number().int().min(0).max(300),
  ordersPerQuarterHour: z.number().int().min(1).max(40),
  prepMinutes: z.number().int().min(3).max(90),
  featuredItemIds: z.array(z.string().min(1)).max(5),
});

export type AgentRules = z.infer<typeof agentRulesSchema>;

/** What a hold is for. The server prices it; the client never sends an amount. */
export const holdPurposeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('merchant-offer'), offerId: z.string().min(1) }),
]);

export type HoldPurpose = z.infer<typeof holdPurposeSchema>;

/** The merchant panel. Customers appear by alias only, with the preferences that matter. */
const ticketLineSchema = rewardOfferSchema.shape.lines.element;

export const kitchenTicketSchema = z.object({
  orderId: z.string(),
  code: orderViewSchema.shape.code,
  alias: z.string(),
  status: orderStatusSchema,
  pickupAt: instantSchema,
  kitchenStartsAt: instantSchema,
  lines: z.array(ticketLineSchema),
  payment: orderPaymentSchema,
});

export const merchantRequestSchema = z.object({
  threadId: z.string(),
  at: instantSchema,
  alias: z.string(),
  craving: z.string(),
  status: threadSchema.shape.status,
  offer: rewardOfferSchema.nullable(),
  conversation: z.array(conversationEntrySchema),
});

export const merchantTodaySchema = z.object({
  merchant: merchantSummarySchema,
  arriving: z.array(kitchenTicketSchema),
  sales: moneySchema,
  orders: z.number().int(),
  offers: z.number().int(),
  /** Offers reserved over offers made today, in whole percent; null without offers. */
  conversionPercent: z.number().int().nullable(),
  averageRewardPercent: z.number().int().nullable(),
});

export const merchantCustomerSchema = z.object({
  alias: z.string(),
  offers: z.number().int(),
  orders: z.number().int(),
  lastSeenAt: instantSchema,
});

export const payoutViewSchema = z.object({
  id: z.string(),
  status: z.enum(['unknown', 'pending', 'processing', 'success', 'denied', 'canceled', 'failed']),
  /** The sales in the batch less the refunds deducted from it; the fee is taken on this. */
  gross: moneySchema,
  fee: moneySchema,
  net: moneySchema,
  /** Refunds deducted from this batch, made after or before their sale was paid out. */
  refunds: moneySchema.default({ amountMinor: 0, currency: 'USD' }),
  until: instantSchema,
  createdAt: instantSchema,
  detail: z.string().nullable(),
});
