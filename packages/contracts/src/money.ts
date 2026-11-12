import { z } from 'zod';

/** Money in integer minor units (cents) with its currency. Only the server sets amounts. */
export const moneySchema = z.object({
  amountMinor: z.number().int(),
  currency: z.literal('USD'),
});

export type Money = z.infer<typeof moneySchema>;
