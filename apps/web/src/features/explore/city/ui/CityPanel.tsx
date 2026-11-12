import type { BoundingBox, CityGroup, CityLayerId, CityLayerSummary } from '@moviq/contracts';
import { useState } from 'react';

import { useLocale } from '../../../../shared/i18n';
import { formatCityTime } from '../../../../shared/time/city';
import { Icon } from '../../../../shared/ui/Icon';
import { ageText } from '../../model/card';
import { publishedDay, type SourceAge } from '../../model/source';
import { CITY_GROUPS } from '../model/layers';
import { groupOnCount, layerAge, layersOf, noteOf } from '../model/panel';
import { useCityT } from '../texts';
import type { CityDict } from '../texts-en';
import type { CityLayersView } from '../useCityLayers';
import type { RadarView } from '../useRadar';
import { LayerNoteText, LayerRow } from './LayerRow';

interface PanelProps {
  readonly city: CityLayersView;
  readonly radar: RadarView;
  readonly box: BoundingBox;
  readonly now: number;
  readonly onOpen: (id: string) => void;
}

/** How old a layer is: so long ago, or in force since the day its file was published. */
const ageWords = (age: SourceAge, t: CityDict, locale: string): string =>
  age.kind === 'published' ? t.inForce(publishedDay(age.at, locale)) : t.age(ageText(age.seconds));

/** One layer the server counts, with its state, its age and, while on, its note or list. */
function ServedLayer({ summary, props }: { summary: CityLayerSummary; props: PanelProps }) {
  const t = useCityT();
  const locale = useLocale();
  const { city } = props;
  const data = city.data;
  if (data === null) return null;
  const age = layerAge(summary, data.sources);
  const unavailable = summary.status === 'unavailable';
  const answered = new Set<CityLayerId>(data.asked);
  const marks: Partial<Record<CityLayerId, string>> = t.marks;
  return (
    <LayerRow
      layer={summary.layer}
      name={t.layers[summary.layer]}
      count={unavailable ? t.noDataCount : summary.count.toLocaleString(locale)}
      on={city.on.has(summary.layer)}
      onToggle={() => {
        city.toggle(summary.layer);
      }}
      state={summary.status}
      stateText={[
        t.status[summary.status],
        ...(age === null ? [] : [ageWords(age, t, locale)]),
        ...(summary.leftOut > 0 ? [t.leftOut(summary.leftOut)] : []),
      ].join(' · ')}
      mark={marks[summary.layer]}
    >
      {summary.layer === 'street-permits' && !unavailable && (
        <>
          <span className="ex-k">{t.byBorough}</span>
          <ul className="ex-city-breakdown">
            {summary.breakdown.map((row) => (
              <li key={row.label}>
                <span>{row.label}</span>
                <span className="mono">{row.count.toLocaleString(locale)}</span>
              </li>
            ))}
          </ul>
          <p className="ex-note">{t.unplacedPermits}</p>
        </>
      )}
      <LayerNoteText
        note={noteOf(summary.layer, data, props.box, city.items, answered, props.now)}
        now={props.now}
        onOpen={props.onOpen}
      />
    </LayerRow>
  );
}

/** The parking signs, asked by tile around the centre of the map once it is near enough. */
function SignsLayer({ props }: { props: PanelProps }) {
  const t = useCityT();
  const locale = useLocale();
  const { city } = props;
  const on = city.on.has('parking-signs');
  const signs = city.signs;
  const state =
    signs === null ? 'unknown' : signs.source.state === 'healthy' ? 'live' : 'unavailable';
  const answered = new Set<CityLayerId>(signs === null ? [] : ['parking-signs']);
  return (
    <LayerRow
      layer="parking-signs"
      name={t.layers['parking-signs']}
      count={signs === null ? '—' : signs.items.length.toLocaleString(locale)}
      on={on}
      onToggle={() => {
        city.toggle('parking-signs');
      }}
      state={state}
      stateText={
        signs === null
          ? t.signsAsk
          : t.status[signs.source.state === 'healthy' ? 'live' : 'unavailable']
      }
      mark={t.marks['parking-signs']}
    >
      {city.data !== null && (
        <LayerNoteText
          note={noteOf(
            'parking-signs',
            city.data,
            props.box,
            signs?.items ?? [],
            answered,
            props.now,
          )}
          now={props.now}
          onOpen={props.onOpen}
        />
      )}
    </LayerRow>
  );
}

/** NOAA's radar mosaic over the map, asked every two minutes while on. */
function RadarLayer({ radar }: { radar: RadarView }) {
  const t = useCityT();
  const locale = useLocale();
  return (
    <LayerRow
      layer="radar"
      name={t.radar.name}
      count=""
      on={radar.on}
      onToggle={radar.toggle}
      state={radar.on ? 'live' : 'unknown'}
      stateText={
        radar.askedAt === null
          ? t.radar.mark
          : t.radar.asked(formatCityTime(new Date(radar.askedAt).toISOString(), locale))
      }
      mark={radar.on ? t.radar.mark : undefined}
    />
  );
}

/** A group of layers: its name and how many are on, open or closed by the traveller. */
function Group({
  group,
  props,
  tourist,
}: {
  group: CityGroup;
  props: PanelProps;
  tourist: boolean;
}) {
  const t = useCityT();
  const [open, setOpen] = useState(group === 'street' || (tourist && group === 'places'));
  const layers = layersOf(props.city.data, group);
  const extra =
    group === 'weather'
      ? props.radar
      : group === 'places'
        ? { on: props.city.on.has('parking-signs') }
        : undefined;
  const count = groupOnCount(layers, props.city.on, extra);
  return (
    <section className="ex-modes ex-city-group" aria-label={t.groups[group]}>
      <button
        type="button"
        className="ex-city-head"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <span className="ex-city-title">{t.groups[group]}</span>
        <span className="ex-note">{t.layersOn(count.on, count.all)}</span>
        <Icon name="chevron" className={open ? 'open' : ''} />
      </button>
      {open && (
        <ul>
          {layers.map((summary) => (
            <ServedLayer key={summary.layer} summary={summary} props={props} />
          ))}
          {group === 'places' && <SignsLayer props={props} />}
          {group === 'weather' && <RadarLayer radar={props.radar} />}
        </ul>
      )}
    </section>
  );
}

/** The city layers by group, under the modes of transport and the events. */
export function CityPanel(props: PanelProps & { readonly destination: string | null }) {
  const t = useCityT();
  if (props.city.data === null) {
    return props.city.failing ? <p className="ex-note">{t.failed}</p> : null;
  }
  return (
    <>
      {props.city.failing && <p className="ex-note">{t.failed}</p>}
      {CITY_GROUPS.map((group) => (
        <Group
          key={`${group}-${props.destination}`}
          group={group}
          props={props}
          tourist={props.destination === 'tourist'}
        />
      ))}
    </>
  );
}

/** The transport group's own city layer, the transit alerts, under the modes. */
export function TransportLayers(props: PanelProps) {
  const layers = layersOf(props.city.data, 'transport');
  if (layers.length === 0) return null;
  return (
    <div className="ex-modes ex-city-transport">
      <ul>
        {layers.map((summary) => (
          <ServedLayer key={summary.layer} summary={summary} props={props} />
        ))}
      </ul>
    </div>
  );
}
