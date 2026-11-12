import type { AgentRules } from '../schemas';
import type { MerchantDict } from '../texts';

/** The numeric rules of "Your agent", as the form edits them. */
export const RULE_FIELDS = [
  'maxDiscountPercent',
  'minMarginPercent',
  'ordersPerQuarterHour',
  'prepMinutes',
] as const;

export type RuleField = (typeof RULE_FIELDS)[number];

/** What the form holds: each number as typed, and the dishes to offer first. */
export interface RulesForm {
  readonly values: Readonly<Record<RuleField, string>>;
  readonly featuredItemIds: readonly string[];
}

/** The same bounds as `agentRulesSchema` in the contracts, which the server enforces. */
const RULE_BOUNDS: Readonly<Record<RuleField, readonly [number, number]>> = {
  maxDiscountPercent: [0, 60],
  minMarginPercent: [0, 300],
  ordersPerQuarterHour: [1, 40],
  prepMinutes: [3, 90],
};

const MAX_FEATURED = 5;

export type RulesCheck =
  | { readonly ok: true; readonly rules: AgentRules }
  | {
      readonly ok: false;
      readonly errors: Partial<Record<RuleField | 'featuredItemIds', string>>;
    };

export function formOf(rules: AgentRules): RulesForm {
  return {
    values: {
      maxDiscountPercent: String(rules.maxDiscountPercent),
      minMarginPercent: String(rules.minMarginPercent),
      ordersPerQuarterHour: String(rules.ordersPerQuarterHour),
      prepMinutes: String(rules.prepMinutes),
    },
    featuredItemIds: rules.featuredItemIds,
  };
}

const wholeNumber = (text: string): number | null =>
  /^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : null;

/**
 * The rules as the server will accept them: whole numbers inside the contract's bounds, a maximum
 * discount no lower than MovIQ's minimum reward (or no offer could pass), and up to five dishes.
 * The server checks all of it again; this only says what is wrong before asking.
 */
export function checkRules(
  form: RulesForm,
  minRewardPercent: number,
  t: MerchantDict['agent'],
): RulesCheck {
  const errors: Partial<Record<RuleField | 'featuredItemIds', string>> = {};
  const numbers: Partial<Record<RuleField, number>> = {};
  for (const field of RULE_FIELDS) {
    const [low, high] = RULE_BOUNDS[field];
    const value = wholeNumber(form.values[field]);
    if (value === null || value < low || value > high) errors[field] = t.range(low, high);
    else numbers[field] = value;
  }
  const discount = numbers.maxDiscountPercent;
  if (discount !== undefined && discount < minRewardPercent) {
    errors.maxDiscountPercent = t.belowMinimum(minRewardPercent);
  }
  if (form.featuredItemIds.length > MAX_FEATURED) errors.featuredItemIds = t.tooMany;
  const { maxDiscountPercent, minMarginPercent, ordersPerQuarterHour, prepMinutes } = numbers;
  if (
    Object.keys(errors).length > 0 ||
    maxDiscountPercent === undefined ||
    minMarginPercent === undefined ||
    ordersPerQuarterHour === undefined ||
    prepMinutes === undefined
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    rules: {
      maxDiscountPercent,
      minMarginPercent,
      ordersPerQuarterHour,
      prepMinutes,
      featuredItemIds: [...form.featuredItemIds],
    },
  };
}
