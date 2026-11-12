import type { EventCategory, MovIqEvent } from '@moviq/contracts';
import type { KeyboardEvent } from 'react';

import { useLocale } from '../../../../shared/i18n';
import { formatCityDay, formatCityTime } from '../../../../shared/time/city';
import { Icon } from '../../../../shared/ui/Icon';
import { categoriesIn, layerStatus, missingSources, ofCategory } from '../model/layer';
import { EVENT_RANGES, type EventRange } from '../model/range';
import { useEventsT } from '../texts';
import type { EventLayer } from '../useEvents';

/** At most this many events are listed in the panel; the rest are on the map. */
const LISTED = 5;

/** Today, tonight or this weekend; one choice at a time, arrows move it. */
function RangeSwitch({
  range,
  onChange,
}: {
  range: EventRange;
  onChange: (r: EventRange) => void;
}) {
  const t = useEventsT();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = (EVENT_RANGES.indexOf(range) + step + EVENT_RANGES.length) % EVENT_RANGES.length;
    const next = EVENT_RANGES[index] ?? range;
    onChange(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-range="${next}"]`)?.focus();
  };
  return (
    <div
      className="ex-ev-ranges"
      role="radiogroup"
      aria-label={t.ranges.label}
      onKeyDown={onKeyDown}
    >
      {EVENT_RANGES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={range === option}
          tabIndex={range === option ? 0 : -1}
          data-range={option}
          onClick={() => {
            onChange(option);
          }}
        >
          {t.ranges[option]}
        </button>
      ))}
    </div>
  );
}

function CategoryChips(props: {
  events: readonly MovIqEvent[];
  category: EventCategory | null;
  onChange: (category: EventCategory | null) => void;
}) {
  const t = useEventsT();
  const present = categoriesIn(props.events);
  if (present.length < 2) return null;
  const chip = (value: EventCategory | null, label: string) => (
    <button
      key={value ?? 'all'}
      type="button"
      aria-pressed={props.category === value}
      onClick={() => {
        props.onChange(value);
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="ex-ev-chips" role="group" aria-label={t.categoriesLabel}>
      {chip(null, t.all)}
      {present.map((category) => chip(category, t.categories[category]))}
    </div>
  );
}

function EventRow({ event, onOpen }: { event: MovIqEvent; onOpen: (id: string) => void }) {
  const t = useEventsT();
  const locale = useLocale();
  return (
    <li>
      <button
        type="button"
        className={`ex-near ex-ev-row${event.status === 'scheduled' ? '' : ' off'}`}
        aria-label={t.open(event.name)}
        onClick={() => {
          onOpen(event.id);
        }}
      >
        <time className="mono" dateTime={event.startsAt}>
          <span>{formatCityTime(event.startsAt, locale)}</span>
          <span className="ex-ev-day">{formatCityDay(event.startsAt, locale)}</span>
        </time>
        <span className="ex-near-main">
          <span className="ex-near-to">{event.name}</span>
          <span className="ex-note">
            {event.status === 'scheduled' ? event.venue.name : t.status[event.status]}
          </span>
        </span>
      </button>
    </li>
  );
}

/** The events layer in the panel: on or off, when, what kind, the next ones and who is missing. */
export function EventsPanel({
  layer,
  onOpen,
  tourist = false,
}: {
  layer: EventLayer;
  onOpen: (id: string) => void;
  tourist?: boolean;
}) {
  const t = useEventsT();
  const locale = useLocale();
  const { data } = layer;
  const all = data?.events ?? [];
  const shown = ofCategory(all, layer.category);
  const status = data === null ? 'unknown' : layerStatus(data);
  const missing = data === null ? [] : missingSources(data);
  return (
    <section
      className="ex-modes ex-events"
      aria-label={tourist ? t.tourist : t.layer}
      id={tourist ? 'explore-tourist' : undefined}
      tabIndex={-1}
    >
      {tourist && (
        <>
          <h2 className="ex-city-title">{t.tourist}</h2>
          <p className="ex-note">{t.touristScope}</p>
        </>
      )}
      <button
        type="button"
        className="ex-mode"
        aria-pressed={layer.on}
        aria-label={t.show}
        onClick={layer.toggle}
      >
        <span className={`ex-mode-check${layer.on ? ' on' : ''}`} aria-hidden="true" />
        <Icon name="flag" />
        <span className="ex-mode-name">{t.layer}</span>
        <span className="ex-mode-count mono">
          {data === null ? '—' : shown.length.toLocaleString(locale)}
        </span>
      </button>
      {layer.on && (
        <div className="ex-ev-body">
          <RangeSwitch range={layer.range} onChange={layer.setRange} />
          <CategoryChips events={all} category={layer.category} onChange={layer.setCategory} />
          {data === null ? (
            <p className="ex-note" role="status">
              {layer.failing ? t.failed : t.loading}
            </p>
          ) : shown.length === 0 ? (
            <p className="ex-note">{t.none}</p>
          ) : (
            <ul className="ex-ev-list">
              {shown.slice(0, LISTED).map((event) => (
                <EventRow key={event.id} event={event} onOpen={onOpen} />
              ))}
            </ul>
          )}
          {shown.length > LISTED && <p className="ex-note">{t.more(shown.length - LISTED)}</p>}
          {data !== null && layer.failing && (
            <p className="ex-note" role="status">
              {t.failed}
            </p>
          )}
          {missing.length > 0 && (
            <p className="ex-mode-state">
              <span
                className={`ex-dot ${status === 'unknown' ? 'unavailable' : status}`}
                aria-hidden="true"
              />
              {t.missing(missing.map((source) => source.title).join(', '))}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
