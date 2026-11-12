import type { CityLayerId } from '@moviq/contracts';
import { useCityT } from '../city/texts';
import type { CityLayersView } from '../city/useCityLayers';
import { SourceLine } from './SourceLine';
import { useDestinationT } from './texts';

const LIMIT = 30;
export function CityItems({
  city,
  layers,
  query,
  onOpen,
}: {
  city: CityLayersView;
  layers: readonly CityLayerId[];
  query: string;
  onOpen: (id: string) => void;
}) {
  const t = useDestinationT();
  const ct = useCityT();
  const data = city.data;
  if (data === null) return <p role="status">{city.failing ? t.unavailable : t.loading}</p>;
  const summaries = data.layers.filter((row) => layers.includes(row.layer));
  const items = city.items.filter(
    (item) =>
      layers.includes(item.layer) &&
      item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const waiting = layers.some((layer) => !data.asked.includes(layer));
  const unavailable = summaries.some((row) => row.status === 'unavailable');
  const incomplete = summaries.some((row) => row.status === 'degraded');
  return (
    <div className="destination-city">
      {city.failing && <p role="status">{t.failed}</p>}
      <ul className="destination-summaries">
        {summaries.map((summary) => (
          <li key={summary.layer}>
            <span>{ct.layers[summary.layer]}</span>
            <span>
              {ct.status[summary.status]} ·{' '}
              {summary.status === 'unavailable'
                ? '—'
                : `${summary.count.toLocaleString()} ${t.citywide}`}
            </span>
          </li>
        ))}
      </ul>
      {waiting && <p role="status">{t.loading}</p>}
      {unavailable && <p role="status">{t.unavailable}</p>}
      {incomplete && <p role="status">{t.incomplete}</p>}
      {!waiting && !unavailable && !incomplete && items.length === 0 && <p>{t.none}</p>}
      <ul className="destination-list">
        {items.slice(0, LIMIT).map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => {
                onOpen(item.id);
              }}
            >
              <strong>{item.title}</strong>
              <span>{ct.layers[item.layer]}</span>
            </button>
            <SourceLine
              source={data.sources.find((source) => source.provenance.sourceId === item.sourceId)}
            />
          </li>
        ))}
      </ul>
      {items.length > LIMIT && <p>{t.limit}</p>}
    </div>
  );
}
