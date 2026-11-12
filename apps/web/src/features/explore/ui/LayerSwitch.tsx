import type { KeyboardEvent } from 'react';

import type { MapView } from '../map/basemap';
import { useExploreT } from '../texts';

const VIEWS: readonly MapView[] = ['2d', 'photo'];

/** The flat 2D map or the aerial photo; one choice at a time, arrows move it. */
export function LayerSwitch({
  view,
  onChange,
}: {
  view: MapView;
  onChange: (view: MapView) => void;
}) {
  const t = useExploreT();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = VIEWS[(VIEWS.indexOf(view) + step + VIEWS.length) % VIEWS.length] ?? view;
    onChange(next);
    const target = event.currentTarget.querySelector<HTMLButtonElement>(`[data-view="${next}"]`);
    target?.focus();
  };
  return (
    <div className="ex-layers" role="radiogroup" aria-label={t.layers.label} onKeyDown={onKeyDown}>
      {VIEWS.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={view === option}
          tabIndex={view === option ? 0 : -1}
          data-view={option}
          className={view === option ? 'on' : ''}
          onClick={() => {
            onChange(option);
          }}
        >
          {t.layers[option]}
        </button>
      ))}
    </div>
  );
}
