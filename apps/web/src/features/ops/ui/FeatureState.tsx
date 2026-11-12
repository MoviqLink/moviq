import type { OpsSummary } from '@moviq/contracts';

import { useT } from '../../../shared/i18n';
import { Icon } from '../../../shared/ui/Icon';
import { STATE_ICON } from '../model/states';

type FeatureStatus = OpsSummary['features'][number]['state'];

/** A feature's state borrows the look of the source state it is closest to. */
const LOOK = { available: 'healthy', degraded: 'degraded', unavailable: 'unavailable' } as const;

/** Whether a product feature works, as icon, colour and word. */
export function FeatureState({ state }: { state: FeatureStatus }) {
  const label = useT().features[state];
  const look = LOOK[state];
  return (
    <span className={`state st-${look}`}>
      <Icon name={STATE_ICON[look]} />
      <span className="state-word">{label}</span>
    </span>
  );
}
