import type { SourceState } from '@moviq/contracts';

import { useT } from '../../../shared/i18n';
import { Icon } from '../../../shared/ui/Icon';
import { STATE_ICON } from '../model/states';

/** A source state as icon, colour and word together, so colour is never the only signal. */
export function StateLabel({ state, hint = false }: { state: SourceState; hint?: boolean }) {
  const text = useT().states[state];
  return (
    <span className={`state st-${state}`} title={text.hint}>
      <Icon name={STATE_ICON[state]} />
      <span className="state-word">{text.label}</span>
      {hint && <span className="state-hint">{text.hint}</span>}
    </span>
  );
}
