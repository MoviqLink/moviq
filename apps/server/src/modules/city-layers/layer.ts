import {
  cityItemSchema,
  type CityGroup,
  type CityItem,
  type CityLayerId,
  type CityLayerStatus,
  type LiveSource,
} from '@moviq/contracts';

import type { SourceDefinition } from '../data-platform/definition.js';
import type { SourceReader, SourceReading } from '../data-platform/reader.js';
import { liveSource } from '../live/sources.js';

/** What one layer shows now, how it splits, and every source it read with its state. */
export interface LayerReading {
  readonly items: readonly CityItem[];
  /** Items in the whole city, served or only counted. */
  readonly count: number;
  /** Items a source listed that do not hold to the contract, so are not shown. */
  readonly leftOut: number;
  readonly breakdown: readonly { readonly label: string; readonly count: number }[];
  readonly sources: readonly LiveSource[];
  readonly status: CityLayerStatus;
}

export interface CityLayer {
  readonly id: CityLayerId;
  readonly group: CityGroup;
  read(reader: SourceReader, now: Date): Promise<LayerReading>;
}

/** One source of a layer and what it shows of the source's data at `now`. */
interface PartSpec<T> {
  readonly source: SourceDefinition<T>;
  readonly items: (data: T, now: Date) => readonly CityItem[];
  /**
   * For a part counted and never served, as street permits, which no source places: its label
   * in the layer's breakdown and its count.
   */
  readonly tally?: (data: T) => { readonly label: string; readonly count: number };
  /**
   * True when what the part shows depends on the hour (an alert that expires): it is worked out
   * on every read instead of once per version of the data.
   */
  readonly timely?: boolean;
}

/** A part read: its items, its source as Explore cites it and whether it had data. */
interface PartReading {
  readonly items: readonly CityItem[];
  readonly leftOut: number;
  readonly tally: { readonly label: string; readonly count: number } | undefined;
  readonly source: LiveSource;
  readonly served: boolean;
}

/** A part with its data type closed over, so parts of different sources sit in one list. */
export interface LayerPart {
  read(reader: SourceReader, now: Date): Promise<PartReading>;
}

interface Checked {
  readonly items: readonly CityItem[];
  readonly leftOut: number;
}

const NOTHING: Checked = { items: [], leftOut: 0 };

/**
 * The items that hold to the contract: one item a source words oddly is left out and counted,
 * so it never refuses the whole answer on the traveller's screen.
 */
function checked(items: readonly CityItem[]): Checked {
  const valid = items.filter((item) => cityItemSchema.safeParse(item).success);
  return { items: valid, leftOut: items.length - valid.length };
}

/** Binds a source to its mapping; the items are worked out once per version served. */
export function part<T>(spec: PartSpec<T>): LayerPart {
  let kept: { readonly version: string; readonly value: Checked } | undefined;
  const itemsOf = (reading: SourceReading<T>, now: Date): Checked => {
    const { data, version } = reading;
    if (data === undefined) return NOTHING;
    if (spec.timely === true || version === undefined) return checked(spec.items(data, now));
    if (kept?.version !== version) kept = { version, value: checked(spec.items(data, now)) };
    return kept.value;
  };
  return {
    async read(reader, now) {
      const reading = await reader.read(spec.source);
      const { data } = reading;
      const { items, leftOut } = itemsOf(reading, now);
      return {
        items,
        leftOut,
        tally: data === undefined ? undefined : spec.tally?.(data),
        source: liveSource(spec.source, reading),
        served: reading.data !== undefined,
      };
    },
  };
}

/**
 * `unavailable` when no source has usable data, so no count reads as "none"; `degraded` when one
 * is not healthy; `live` otherwise.
 */
function statusOf(parts: readonly PartReading[]): CityLayerStatus {
  if (!parts.some((reading) => reading.served)) return 'unavailable';
  const healthy = parts.every((reading) => reading.source.provenance.state === 'healthy');
  return healthy ? 'live' : 'degraded';
}

/** One item per id: two sources of a layer may list the same event; the first one stays. */
function unique(items: readonly CityItem[]): CityItem[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.id) && seen.add(item.id));
}

/** A layer read from one or more platform sources, each mapped into items. */
export function layerOf(id: CityLayerId, group: CityGroup, parts: readonly LayerPart[]): CityLayer {
  return {
    id,
    group,
    async read(reader, now) {
      const readings = await Promise.all(parts.map((one) => one.read(reader, now)));
      const items = unique(readings.flatMap((reading) => reading.items));
      const tallies = readings.flatMap((reading) =>
        reading.tally === undefined ? [] : [reading.tally],
      );
      return {
        items,
        count: tallies.reduce((total, tally) => total + tally.count, items.length),
        leftOut: readings.reduce((total, reading) => total + reading.leftOut, 0),
        breakdown: tallies,
        sources: readings.map((reading) => reading.source),
        status: statusOf(readings),
      };
    },
  };
}
