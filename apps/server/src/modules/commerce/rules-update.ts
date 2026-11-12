import { hoursProblem, type AgentRules, type WeeklyHours } from '@moviq/contracts';

import type { CommerceDependencies } from './context.js';
import { merchantStore, type Merchant } from './merchants.js';
import { hoursRefusal } from './opening-hours.js';

interface SavedSetup {
  readonly rules: AgentRules;
  readonly hours: WeeklyHours;
  readonly version: number;
}

export type RulesUpdate =
  | { readonly ok: true; readonly saved: SavedSetup }
  | { readonly ok: false; readonly message: string };

/** What the merchant sends from "Your agent": the hours stay as they are when left out. */
export interface RulesChange {
  readonly rules: AgentRules;
  readonly hours?: WeeklyHours | undefined;
  readonly version: number;
}

type Check =
  | { readonly ok: true; readonly hours: WeeklyHours }
  | { readonly ok: false; readonly message: string };

/**
 * Whether "Your agent" may take these rules: they must leave room for the program's minimum
 * reward, name only items of its menu, and open at least once a week in stretches that close
 * after they open and never overlap. Saving and the agent's own proposals both go through it.
 */
export async function checkRulesChange(
  deps: Pick<CommerceDependencies, 'db' | 'settings'>,
  merchant: Merchant,
  change: Omit<RulesChange, 'version'>,
): Promise<Check> {
  const { rules } = change;
  const minimum = deps.settings.minRewardPercent;
  if (rules.maxDiscountPercent < minimum) {
    return {
      ok: false,
      message:
        `MovIQ requires every offer to be at least ${String(minimum)}% below the menu price, ` +
        'so the maximum discount cannot be lower.',
    };
  }
  const setup = await merchantStore.setup(deps.db, merchant);
  const unknown = rules.featuredItemIds.filter((id) => !setup.menu.some((item) => item.id === id));
  if (unknown.length > 0) return { ok: false, message: `Not on your menu: ${unknown.join(', ')}.` };
  const hours = change.hours ?? setup.hours;
  const problem = hoursProblem(hours);
  return problem === null ? { ok: true, hours } : { ok: false, message: hoursRefusal(problem) };
}

/** "Your agent": the merchant saves what its agent may do, from the version it read. */
export async function updateRules(
  deps: Pick<CommerceDependencies, 'db' | 'clock' | 'settings'>,
  merchant: Merchant,
  change: RulesChange,
): Promise<RulesUpdate> {
  const checked = await checkRulesChange(deps, merchant, change);
  if (!checked.ok) return checked;
  const { rules, version } = change;
  const { hours } = checked;
  const saved = await deps.db.transaction((tx) =>
    merchantStore.saveRules(tx, merchant.summary.id, { rules, hours, version }, deps.clock.now()),
  );
  if (!saved)
    return { ok: false, message: 'These rules changed since you opened them. Open them again.' };
  return { ok: true, saved: { rules, hours, version: version + 1 } };
}
