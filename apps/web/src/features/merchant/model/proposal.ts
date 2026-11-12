import { WEEKDAYS } from '@moviq/contracts';

import type { AgentProposal, AgentSetup, WeeklyHours } from '../schemas';
import type { MerchantDict } from '../texts';
import { RULE_FIELDS } from './rules';

type Day = WeeklyHours['mon'];

const dayText = (slots: Day, t: MerchantDict['hours']) =>
  slots.length === 0 ? t.closed : slots.map((slot) => `${slot.opens}–${slot.closes}`).join(', ');

/**
 * What a change the agent proposes would change, one line each, so the merchant confirms
 * knowing it: each rule from its value to the new one, the dishes offered first and each day
 * whose hours move. Nothing that stays the same is listed.
 */
export function proposalChanges(
  setup: Pick<AgentSetup, 'rules' | 'hours' | 'menu'>,
  proposal: Pick<AgentProposal, 'rules' | 'hours'>,
  t: Pick<MerchantDict, 'agent' | 'hours' | 'talk'>,
): string[] {
  const names = {
    maxDiscountPercent: [t.agent.maxDiscount, t.agent.percent],
    minMarginPercent: [t.agent.minMargin, t.agent.percent],
    ordersPerQuarterHour: [t.agent.capacity, ''],
    prepMinutes: [t.agent.prep, t.agent.minutes],
  } as const;
  const changes: string[] = [];
  for (const field of RULE_FIELDS) {
    const [name, unit] = names[field];
    const before = setup.rules[field];
    const after = proposal.rules[field];
    if (before !== after)
      changes.push(
        t.talk.change(name, `${String(before)} ${unit}`.trim(), `${String(after)} ${unit}`.trim()),
      );
  }
  const dish = (id: string) => setup.menu.find((item) => item.id === id)?.name ?? id;
  const featured = (ids: readonly string[]) =>
    ids.length === 0 ? t.talk.none : ids.map(dish).join(', ');
  if (featured(setup.rules.featuredItemIds) !== featured(proposal.rules.featuredItemIds)) {
    changes.push(
      t.talk.change(
        t.agent.featured,
        featured(setup.rules.featuredItemIds),
        featured(proposal.rules.featuredItemIds),
      ),
    );
  }
  for (const day of WEEKDAYS) {
    const before = dayText(setup.hours[day], t.hours);
    const after = dayText(proposal.hours[day], t.hours);
    if (before !== after) changes.push(t.talk.change(t.hours.days[day], before, after));
  }
  return changes;
}
