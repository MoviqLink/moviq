import type { Transaction } from '@libsql/client';
import {
  agentRulesSchema,
  allergenSchema,
  toInstant,
  type AgentRules,
  type Allergen,
  type MerchantSummary,
  weeklyHoursSchema,
  type WeeklyHours,
} from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';

interface Ingredient {
  readonly name: string;
  readonly allergens: readonly Allergen[];
  readonly removable: boolean;
}

interface Extra {
  readonly name: string;
  readonly priceMinor: number;
  readonly allergens: readonly Allergen[];
}

export interface MenuItem {
  readonly id: string;
  readonly name: string;
  readonly category: 'meal' | 'coffee' | 'snack' | 'drink' | 'goods';
  readonly priceMinor: number;
  readonly costMinor: number;
  readonly diet: 'any' | 'vegetarian' | 'vegan';
  readonly alcohol: boolean;
  readonly ingredients: readonly Ingredient[];
  readonly extras: readonly Extra[];
  readonly keywords: readonly string[];
}

export interface Merchant {
  readonly summary: MerchantSummary;
  readonly codeLetter: string;
  readonly payoutReceiver: string;
  readonly stopAt: { readonly lat: number; readonly lon: number };
}

export interface MerchantAgentSetup {
  readonly merchant: Merchant;
  readonly menu: readonly MenuItem[];
  readonly rules: AgentRules;
  /** When the agent may promise a pickup, New York wall clock, saved with the rules. */
  readonly hours: WeeklyHours;
  readonly rulesVersion: number;
}

const json = <T>(schema: z.ZodType<T>) =>
  z.string().transform((text, context): T => {
    const parsed = schema.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data;
    context.addIssue({ code: 'custom', message: parsed.error.message });
    return z.NEVER;
  });

const merchantRow = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(['restaurant', 'cafe', 'shop']),
    lat: z.number(),
    lon: z.number(),
    stop_id: z.string(),
    stop_name: z.string(),
    stop_lat: z.number(),
    stop_lon: z.number(),
    stop_routes: json(z.array(z.string())),
    walk_minutes: z.number().int().positive(),
    code_letter: z.string().length(1),
    payout_receiver: z.string(),
  })
  .transform((row): Merchant => ({
    summary: {
      id: row.id,
      name: row.name,
      kind: row.kind,
      demo: true,
      stop: { id: row.stop_id, name: row.stop_name, routes: row.stop_routes },
      walkMinutes: row.walk_minutes,
      lat: row.lat,
      lon: row.lon,
    },
    codeLetter: row.code_letter,
    payoutReceiver: row.payout_receiver,
    stopAt: { lat: row.stop_lat, lon: row.stop_lon },
  }));

const allergens = z.array(allergenSchema);
const itemRow = z
  .object({
    id: z.string(),
    name: z.string(),
    category: z.enum(['meal', 'coffee', 'snack', 'drink', 'goods']),
    price_minor: z.number().int().positive(),
    cost_minor: z.number().int().positive(),
    diet: z.enum(['any', 'vegetarian', 'vegan']),
    alcohol: z.number().int(),
    ingredients: json(z.array(z.object({ name: z.string(), allergens, removable: z.boolean() }))),
    extras: json(
      z.array(z.object({ name: z.string(), priceMinor: z.number().int().positive(), allergens })),
    ),
    keywords: json(z.array(z.string())),
  })
  .transform((row): MenuItem => ({
    id: row.id,
    name: row.name,
    category: row.category,
    priceMinor: row.price_minor,
    costMinor: row.cost_minor,
    diet: row.diet,
    alcohol: row.alcohol === 1,
    ingredients: row.ingredients,
    extras: row.extras,
    keywords: row.keywords,
  }));

const rulesRow = z.object({
  rules: json(agentRulesSchema),
  hours: json(weeklyHoursSchema),
  version: z.number().int(),
});

type Reader = Database | Transaction;
const read = (db: Reader, sql: string, args: string[]) =>
  'query' in db ? db.query({ sql, args }) : db.execute({ sql, args });

/** The demo merchants, their menus and the rules of their agents. */
export const merchantStore = {
  async all(db: Database): Promise<readonly Merchant[]> {
    const result = await db.query('SELECT * FROM commerce_merchants ORDER BY name');
    return result.rows.map((row) => parseRow(merchantRow, row, 'commerce_merchants'));
  },

  async find(db: Reader, id: string): Promise<Merchant | undefined> {
    const result = await read(db, 'SELECT * FROM commerce_merchants WHERE id = ?', [id]);
    const row = result.rows[0];
    return row === undefined ? undefined : parseRow(merchantRow, row, 'commerce_merchants');
  },

  async setup(db: Reader, merchant: Merchant): Promise<MerchantAgentSetup> {
    const id = merchant.summary.id;
    const menu = await read(
      db,
      'SELECT * FROM commerce_menu_items WHERE merchant_id = ? ORDER BY id',
      [id],
    );
    const rules = await read(
      db,
      'SELECT rules, hours, version FROM commerce_agent_rules WHERE merchant_id = ?',
      [id],
    );
    const stored = parseRow(rulesRow, rules.rows[0], 'commerce_agent_rules');
    return {
      merchant,
      menu: menu.rows.map((row) => parseRow(itemRow, row, 'commerce_menu_items')),
      rules: stored.rules,
      hours: stored.hours,
      rulesVersion: stored.version,
    };
  },

  /** Saves new rules and hours if nobody saved others since `version` was read. */
  async saveRules(
    tx: Transaction,
    merchantId: string,
    saved: { readonly rules: AgentRules; readonly hours: WeeklyHours; readonly version: number },
    now: Date,
  ): Promise<boolean> {
    const result = await tx.execute({
      sql: `UPDATE commerce_agent_rules SET rules = ?, hours = ?, updated_at = ?,
              version = version + 1
            WHERE merchant_id = ? AND version = ?`,
      args: [
        JSON.stringify(saved.rules),
        JSON.stringify(saved.hours),
        toInstant(now),
        merchantId,
        saved.version,
      ],
    });
    return result.rowsAffected === 1;
  },
};

/** The allergens of an item once the kitchen leaves out `removed` and adds `added`. */
export function allergensOf(
  item: MenuItem,
  removed: readonly string[],
  added: readonly string[],
): ReadonlySet<Allergen> {
  const found = new Set<Allergen>();
  for (const ingredient of item.ingredients) {
    if (!removed.includes(ingredient.name)) ingredient.allergens.forEach((a) => found.add(a));
  }
  for (const extra of item.extras) {
    if (added.includes(extra.name)) extra.allergens.forEach((a) => found.add(a));
  }
  return found;
}
