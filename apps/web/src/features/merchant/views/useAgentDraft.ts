import { useState } from 'react';

import { merchantApi } from '../api';
import { checkHours, type HoursForm } from '../model/hours';
import { checkRules, formOf, type RuleField, type RulesForm } from '../model/rules';
import type { AgentSetup, Weekday } from '../schemas';
import { useMerchantT } from '../texts';
import { useAction, type Action } from '../useAction';

type DraftErrors = Partial<Record<RuleField | 'featuredItemIds' | Weekday | 'week', string>>;

export interface AgentDraft {
  readonly rules: RulesForm;
  readonly hours: HoursForm;
  readonly errors: DraftErrors;
  readonly save: Action;
  readonly setRules: (rules: RulesForm) => void;
  readonly setHours: (hours: HoursForm) => void;
  readonly submit: () => void;
}

/**
 * The rules and opening hours of "Your agent" as the merchant edits them, checked here as the
 * server will check them, then saved together under the version that was read.
 */
export function useAgentDraft(setup: AgentSetup, onSaved: (said: string) => void): AgentDraft {
  const t = useMerchantT();
  const [rules, setRules] = useState<RulesForm>(() => formOf(setup.rules));
  const [hours, setHours] = useState<HoursForm>(setup.hours);
  const [errors, setErrors] = useState<DraftErrors>({});
  const save = useAction();
  const submit = () => {
    const checked = checkRules(rules, setup.minRewardPercent, t.agent);
    const opening = checkHours(hours, t.hours);
    if (!checked.ok || !opening.ok) {
      setErrors({ ...(checked.ok ? {} : checked.errors), ...(opening.ok ? {} : opening.errors) });
      return;
    }
    setErrors({});
    void save
      .run(() => merchantApi.saveAgent(checked.rules, opening.hours, setup.version))
      .then((saved) => {
        if (saved === undefined) return;
        setHours(saved.hours);
        onSaved(t.agent.saved);
      });
  };
  return { rules, hours, errors, save, setRules, setHours, submit };
}
