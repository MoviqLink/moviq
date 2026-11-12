import {
  cityLayerIdSchema,
  type BoundingBox,
  type CityItem,
  type CityLayerId,
  type CityLayersResponse,
  type ParkingSignsResponse,
} from '@moviq/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiRequestError } from '../../../shared/api/errors';
import { startPolling } from '../live/poll';
import { fetchCityLayers, fetchParkingSigns } from './api';
import { askable, drawnItems, FIRST_ON, layersToAsk } from './model/layers';

/** The fastest city layers change every minute or two on the platform: once a minute finds each. */
const POLL_MS = 60_000;

export interface CityLayersView {
  readonly on: ReadonlySet<CityLayerId>;
  readonly toggle: (layer: CityLayerId) => void;
  readonly data: CityLayersResponse | null;
  readonly failing: boolean;
  /** The parking signs of the tile in view, while that layer is on and the map near enough. */
  readonly signs: ParkingSignsResponse | null;
  /** Every item answered, the signs among them, placed or not. */
  readonly items: readonly CityItem[];
  /** What the map draws: the placed items of the layers on. */
  readonly drawn: readonly CityItem[];
}

const isAborted = (error: unknown) =>
  error instanceof ApiRequestError && error.failure.kind === 'aborted';

/** Reads the counts of every layer and the items of those on, once a minute and on each move. */
function useLayerAnswer(box: BoundingBox, asked: string) {
  const [data, setData] = useState<CityLayersResponse | null>(null);
  const [failing, setFailing] = useState(false);
  useEffect(() => {
    const parsed = cityLayerIdSchema.array().safeParse(asked === '' ? [] : asked.split(','));
    const layers = parsed.success ? parsed.data : [];
    return startPolling(async (signal) => {
      try {
        const answer = await fetchCityLayers(box, layers, signal);
        if (!signal.aborted) {
          setData(answer);
          setFailing(false);
        }
      } catch (error) {
        if (!signal.aborted && !isAborted(error)) setFailing(true);
      }
    }, POLL_MS);
  }, [box, asked]);
  return { data, failing };
}

/** The signs of the tile at the centre of the box; the server keeps each tile a day. */
function useParkingSigns(box: BoundingBox, wanted: boolean): ParkingSignsResponse | null {
  const [signs, setSigns] = useState<ParkingSignsResponse | null>(null);
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    const centre = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] as const;
    fetchParkingSigns(centre, controller.signal)
      .then(setSigns)
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [box, wanted]);
  return wanted ? signs : null;
}

/**
 * The city layers of Explore: off until the traveller asks or opens a specialised view.
 * Only the layers on are asked, as the modes are; leaving the screen stops it all.
 */
export function useCityLayers(box: BoundingBox): CityLayersView {
  const [on, setOn] = useState<ReadonlySet<CityLayerId>>(FIRST_ON);
  const asked = layersToAsk(on, box).join(',');
  const { data, failing } = useLayerAnswer(box, asked);
  const signs = useParkingSigns(box, on.has('parking-signs') && askable('parking-signs', box));
  const toggle = useCallback((layer: CityLayerId) => {
    setOn((current) => {
      const next = new Set(current);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  }, []);
  const items = useMemo(() => [...(data?.items ?? []), ...(signs?.items ?? [])], [data, signs]);
  const drawn = useMemo(() => drawnItems(items, on), [items, on]);
  return { on, toggle, data, failing, signs, items, drawn };
}
