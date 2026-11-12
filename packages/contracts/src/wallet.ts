import { z } from 'zod';

import { moneySchema } from './money.js';
import { instantSchema } from './time.js';

/** The least and the most one top-up may add, in cents. */
export const WALLET_TOP_UP_MIN_MINOR = 500;
export const WALLET_TOP_UP_MAX_MINOR = 50_000;

/** `POST /api/wallet/top-ups`: how much to add. The server records it and prices the payment. */
export const createWalletTopUpSchema = z.strictObject({
  amountMinor: z.number().int().min(WALLET_TOP_UP_MIN_MINOR).max(WALLET_TOP_UP_MAX_MINOR),
});

/** A top-up waiting for its PayPal payment: `purpose` is what `/api/payments/orders` takes. */
export const walletTopUpSchema = z.object({
  id: z.uuid(),
  amount: moneySchema,
  purpose: z.object({ kind: z.literal('wallet-top-up'), topUpId: z.uuid() }),
});
export type WalletTopUp = z.infer<typeof walletTopUpSchema>;

/** One line of the trip wallet: money added with PayPal, or a ticket paid from the balance. */
export const walletMovementSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['top-up', 'ticket']),
  /** What it was: "Money added with PayPal", or the ticket's name and operator. */
  label: z.string().min(1),
  /** Positive when money came in, negative when it was spent, in cents of `currency`. */
  amountMinor: z.number().int(),
  currency: z.literal('USD'),
  at: instantSchema,
  /** The PayPal order of a top-up; null for a ticket paid from the balance. */
  paypalOrderId: z.string().nullable(),
});
export type WalletMovement = z.infer<typeof walletMovementSchema>;

/**
 * `GET /api/wallet`: the traveller's trip wallet. Money is added with PayPal and counts once
 * PayPal confirms the capture; Sara pays tickets from the balance.
 */
export const tripWalletSchema = z.object({
  /** False when PayPal sandbox is not set up on the server: nothing can be added. */
  available: z.boolean(),
  balance: moneySchema,
  added: moneySchema,
  spent: moneySchema,
  /** The latest movements first, at most 50. */
  movements: z.array(walletMovementSchema).max(50),
});
export type TripWallet = z.infer<typeof tripWalletSchema>;
