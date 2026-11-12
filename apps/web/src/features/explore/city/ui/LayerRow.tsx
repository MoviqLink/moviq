import type { CityItem, CityLayerId } from '@moviq/contracts';
import type { ReactNode } from 'react';

import { useLocale } from '../../../../shared/i18n';
import { isCityToday, itemTime, type ListedTime } from '../model/layers';
import type { LayerNote } from '../model/panel';
import { useCityCardT, useCityT } from '../texts';
import { whenText } from './Facts';
import { LayerIcon } from './LayerIcon';

interface RowProps {
  readonly layer: CityLayerId | 'radar';
  readonly name: string;
  readonly count: string;
  readonly on: boolean;
  readonly onToggle: () => void;
  /** `live`, `degraded` or `unavailable`, for the dot of the state. */
  readonly state: string;
  readonly stateText: string;
  /** What the layer is and is not, said once under its name. */
  readonly mark: string | undefined;
  readonly children?: ReactNode;
}

/** One city layer: on or off, its count, its state and what it is, then its body while on. */
export function LayerRow(props: RowProps) {
  const t = useCityT();
  return (
    <li
      className="ex-city-layer"
      id={
        props.layer === 'incidents'
          ? 'explore-incidents'
          : props.layer === 'cameras'
            ? 'explore-traffic'
            : undefined
      }
      tabIndex={-1}
    >
      <button
        type="button"
        className="ex-mode"
        aria-pressed={props.on}
        aria-label={t.show(props.name)}
        onClick={props.onToggle}
      >
        <span className={`ex-mode-check${props.on ? ' on' : ''}`} aria-hidden="true" />
        <LayerIcon layer={props.layer} />
        <span className="ex-mode-name">{props.name}</span>
        <span className="ex-mode-count mono">{props.count}</span>
      </button>
      <p className="ex-mode-state">
        <span className={`ex-dot ${props.state}`} aria-hidden="true" />
        {props.stateText}
      </p>
      {props.mark !== undefined && <p className="ex-city-mark">{props.mark}</p>}
      {props.on && props.children !== undefined && (
        <div className="ex-city-body">{props.children}</div>
      )}
    </li>
  );
}

/** At most this many unplaced items are listed under a layer; the rest are counted. */
const LISTED = 5;

/** `19:30`, `Thu, Nov 12 · 19:30`, or `until Thu, Dec 31 · 23:00` for what began another day. */
function ListedWhen({ time, now }: { time: ListedTime; now: number }) {
  const t = useCityT();
  const locale = useLocale();
  const when = whenText(time.at, locale, now);
  if (!time.until) return <>{when}</>;
  return <>{isCityToday(time.at, now) ? t.untilTime(when) : t.untilDay(when)}</>;
}

function ListedItems(props: {
  items: readonly CityItem[];
  now: number;
  onOpen: (id: string) => void;
}) {
  const t = useCityT();
  const card = useCityCardT();
  return (
    <>
      <ul className="ex-city-list">
        {props.items.slice(0, LISTED).map((item) => {
          const time = itemTime(item, props.now);
          return (
            <li key={item.id}>
              <button
                type="button"
                className="ex-near"
                onClick={() => {
                  props.onOpen(item.id);
                }}
              >
                <span className="ex-near-main">
                  <span className="ex-near-to">{item.title}</span>
                  <span className="ex-note">
                    {time === null ? (
                      card.kinds[item.layer]
                    ) : (
                      <ListedWhen time={time} now={props.now} />
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {props.items.length > LISTED && (
        <p className="ex-note">{t.more(props.items.length - LISTED)}</p>
      )}
    </>
  );
}

/** What a layer on says under its row: why nothing is drawn, or its list. */
export function LayerNoteText(props: {
  note: LayerNote;
  now: number;
  onOpen: (id: string) => void;
}) {
  const t = useCityT();
  const locale = useLocale();
  switch (props.note.kind) {
    case 'zoom':
      return <p className="ex-note">{t.zoomIn}</p>;
    case 'loading':
      return <p className="ex-note">{t.loading}</p>;
    case 'capped':
      return <p className="ex-note">{t.capped(props.note.inBox.toLocaleString(locale))}</p>;
    case 'none':
      return <p className="ex-note">{t.noneHere}</p>;
    case 'listed':
      return <ListedItems items={props.note.items} now={props.now} onOpen={props.onOpen} />;
    case 'drawn':
    case 'permits':
      return null;
  }
}
