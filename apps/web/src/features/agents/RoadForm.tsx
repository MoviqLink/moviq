import type { AgentDetail } from '@moviq/contracts';
import { useState } from 'react';
import { agentsApi } from './api';
import { useAgentsT } from './texts';
import { useWhen } from './WatchCard';

interface Segment {
  readonly id: string;
  readonly name: string;
  readonly borough: string | null;
  readonly measuredAt: string;
}

const KMH_PER_MPH = 1.609344;

function SegmentCards({
  segments,
  selected,
  onSelect,
}: {
  segments: readonly Segment[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const t = useAgentsT();
  const when = useWhen();
  return (
    <fieldset>
      <legend className="agents-label">{t.chooseSegment}</legend>
      <p className="agents-road-count">{t.resultsFound(segments.length)}</p>
      <ul className="agents-segments">
        {segments.map((segment) => (
          <li key={segment.id}>
            <label className="agents-segment">
              <input
                type="radio"
                name="road-segment"
                value={segment.id}
                checked={selected === segment.id}
                onChange={() => {
                  onSelect(segment.id);
                }}
                required
              />
              <span className="agents-segment-name">{segment.name}</span>
              <span className="agents-segment-meta">
                {segment.borough === null ? '' : `${segment.borough} · `}
                {t.measured} {when(segment.measuredAt)}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function RoadSelection({
  segments,
  selected,
  threshold,
  onSave,
  onSelect,
  onThreshold,
}: {
  segments: readonly Segment[];
  selected: string;
  threshold: string;
  onSave: () => void;
  onSelect: (value: string) => void;
  onThreshold: (value: string) => void;
}) {
  const t = useAgentsT();
  const kmh = Number(threshold);
  return (
    <form
      className="agents-road-pick"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <SegmentCards segments={segments} selected={selected} onSelect={onSelect} />
      <label htmlFor="road-threshold" className="agents-label">
        {t.threshold}
      </label>
      <div className="agents-row">
        <input
          id="road-threshold"
          type="number"
          min="1"
          max="130"
          step="1"
          value={threshold}
          onChange={(event) => {
            onThreshold(event.target.value);
          }}
          required
        />
        <button type="submit" className="agents-watch-add">
          {t.saveStreet}
        </button>
      </div>
      {kmh >= 1 && (
        <p className="agents-threshold-help">
          {t.thresholdHelp(kmh, Math.round(kmh / KMH_PER_MPH))}
        </p>
      )}
    </form>
  );
}

export function RoadForm({
  id,
  onChange,
}: {
  id: string;
  onChange: (detail: AgentDetail) => void;
}) {
  const t = useAgentsT();
  const [query, setQuery] = useState('');
  const [segments, setSegments] = useState<readonly Segment[] | null>(null);
  const [selected, setSelected] = useState('');
  const [threshold, setThreshold] = useState('30');
  const [failed, setFailed] = useState(false);
  const search = async () => {
    try {
      const result = await agentsApi.roads(query);
      setSegments(result.segments);
      setSelected('');
      setFailed(!result.available);
    } catch {
      setFailed(true);
      setSegments([]);
    }
  };
  const save = async () => {
    const segment = segments?.find((item) => item.id === selected);
    if (segment === undefined) return;
    try {
      onChange(await agentsApi.watchRoad(id, segment.name, segment.id, Number(threshold)));
      setSelected('');
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  return (
    <div className="agents-pane">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label htmlFor="road-search" className="agents-label">
          {t.street}
        </label>
        <div className="agents-row">
          <input
            id="road-search"
            minLength={2}
            maxLength={100}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            required
          />
          <button type="submit">{t.findStreet}</button>
        </div>
      </form>
      {segments !== null && segments.length === 0 && <p role="status">{t.noSegments}</p>}
      {segments !== null && segments.length > 0 && (
        <RoadSelection
          segments={segments}
          selected={selected}
          threshold={threshold}
          onSave={() => {
            void save();
          }}
          onSelect={setSelected}
          onThreshold={setThreshold}
        />
      )}
      {failed && <p role="alert">{t.failed}</p>}
    </div>
  );
}
