import { z } from 'zod';
import { merchantSummarySchema } from './commerce.js';
import { moneySchema } from './money.js';
import { instantSchema } from './time.js';

/** A demo merchant's featured menu item along the traveller's watched journey. */
export const routePromotionsSchema = z.object({
  promotions: z.array(
    z.object({
      merchant: merchantSummarySchema,
      itemId: z.string().min(1),
      name: z.string().min(1),
      listPrice: moneySchema,
      passAt: instantSchema,
    }),
  ),
});
export type RoutePromotions = z.infer<typeof routePromotionsSchema>;
