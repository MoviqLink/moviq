import type { LiveMode, ModeSummary } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import { Icon, type IconName } from '../../../shared/ui/Icon';
import { useExploreT } from '../texts';

const ICONS: Record<LiveMode, IconName> = {
  bus: 'bus',
  subway: 'subway',
  rail: 'rail',
  ferry: 'ferry',
  shuttle: 'bus',
  aircraft: 'plane',
  ship: 'ferry',
  'bike-station': 'pin',
  'rail-station': 'rail',
  micromobility: 'pin',
  airport: 'plane',
};

interface Props {
  readonly modes: readonly ModeSummary[];
  readonly hidden: ReadonlySet<LiveMode>;
  readonly onToggle: (mode: LiveMode) => void;
}

/** One row per mode with a source: its count, its state and whether it is on the map. */
export function ModePanel({ modes, hidden, onToggle }: Props) {
  const t = useExploreT();
  const locale = useLocale();
  const connected = modes.filter((mode) => mode.status !== 'not-connected');
  const missing = modes.filter((mode) => mode.status === 'not-connected');
  return (
    <div className="ex-modes" id="explore-stations" tabIndex={-1}>
      <ul>
        {connected.map((summary) => {
          const on = !hidden.has(summary.mode);
          const left = summary.excluded.reduce((total, row) => total + row.count, 0);
          const reasons = summary.excluded
            .map((row) => `${t.reasons[row.reason]}: ${row.count.toLocaleString(locale)}`)
            .join(' · ');
          return (
            <li key={summary.mode}>
              <button
                type="button"
                className={`ex-mode ${summary.status}`}
                aria-pressed={on}
                aria-label={t.show(t.modes[summary.mode])}
                onClick={() => {
                  onToggle(summary.mode);
                }}
              >
                <span className={`ex-mode-check${on ? ' on' : ''}`} aria-hidden="true" />
                <Icon name={ICONS[summary.mode]} />
                <span className="ex-mode-name">{t.modes[summary.mode]}</span>
                <span className="ex-mode-count mono">{summary.shown.toLocaleString(locale)}</span>
              </button>
              <p className="ex-mode-state">
                <span className={`ex-dot ${summary.status}`} aria-hidden="true" />
                {t.status[summary.status]}
                {left > 0 && (
                  <span title={reasons}>
                    {' · '}
                    {t.leftOut(left)}
                  </span>
                )}
              </p>
            </li>
          );
        })}
      </ul>
      {missing.length > 0 && (
        <p className="ex-missing">
          {t.notConnected(missing.map((summary) => t.modes[summary.mode]).join(', '))}
        </p>
      )}
    </div>
  );
}
