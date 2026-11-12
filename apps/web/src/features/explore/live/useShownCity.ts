import type {
  BoundingBox,
  LiveMode,
  LiveStation,
  LiveVehicle,
  LiveVehiclesResponse,
} from '@moviq/contracts';
import { useMemo, useState } from 'react';
import { CITY_MODES } from '../model/city-now';
import { matchesLine } from '../model/line-selection';
import { modesShown } from '../model/shown';
import { useLiveCity } from './useLiveCity';
import type { useLineSelection } from './useLineSelection';

/** At most this wide, the box is a neighbourhood: its buses are light enough to draw. */
const NEIGHBOURHOOD_DEGREES = 0.1;

export type Selection =
  | { readonly kind: 'vehicle'; readonly item: LiveVehicle; readonly lost: boolean }
  | { readonly kind: 'station'; readonly item: LiveStation };

/** The selected item in the latest data or, once it has left it, the last of it, marked lost. */
function useSelection(data: LiveVehiclesResponse | null, id: string | null): Selection | null {
  const vehicle = data?.vehicles.find((candidate) => candidate.id === id);
  const station = data?.stations.find((candidate) => candidate.id === id);
  const [last, setLast] = useState<LiveVehicle | null>(null);
  if (vehicle !== undefined && vehicle !== last) setLast(vehicle);
  if (id === null) return null;
  if (vehicle !== undefined) return { kind: 'vehicle', item: vehicle, lost: false };
  if (station !== undefined) return { kind: 'station', item: station };
  if (last?.id === id) return { kind: 'vehicle', item: last, lost: true };
  return null;
}

/**
 * The selected lines and optional extra modes; before any choice, the city now (every train,
 * ferry and shuttle followed); or, in a specialised view, its own filters.
 */
export function useShownCity(
  box: BoundingBox,
  hidden: ReadonlySet<LiveMode>,
  selectedId: string | null,
  choice: ReturnType<typeof useLineSelection> | null,
) {
  const wholeCity = choice !== null && choice.lines.length === 0 && choice.others.size === 0;
  const nearby = box[2] - box[0] <= NEIGHBOURHOOD_DEGREES;
  const cityModes = useMemo<readonly LiveMode[]>(
    () => (nearby ? [...CITY_MODES, 'bus'] : CITY_MODES),
    [nearby],
  );
  const modes = useMemo(
    () =>
      choice === null
        ? modesShown(hidden)
        : wholeCity
          ? [...cityModes]
          : [...new Set([...choice.lines.map((line) => line.mode), ...choice.others])],
    [choice, hidden, wholeCity, cityModes],
  );
  const selected =
    choice === null || wholeCity ? undefined : { lines: choice.lines, enabled: true };
  const live = useLiveCity(box, modes, selected);
  const vehicles = useMemo(
    () =>
      (live.data?.vehicles ?? []).filter((vehicle) =>
        choice === null
          ? !hidden.has(vehicle.mode)
          : wholeCity
            ? cityModes.includes(vehicle.mode)
            : matchesLine(vehicle, choice.lines) || choice.others.has(vehicle.mode),
      ),
    [live.data, hidden, choice, wholeCity, cityModes],
  );
  const stations = useMemo(
    () =>
      (live.data?.stations ?? []).filter((station) =>
        choice === null
          ? !hidden.has(station.mode)
          : wholeCity
            ? CITY_MODES.includes(station.mode)
            : choice.others.has(station.mode),
      ),
    [live.data, hidden, choice, wholeCity],
  );
  const data = live.data === null ? null : { ...live.data, vehicles, stations };
  return { live: { ...live, data }, selection: useSelection(data, selectedId), vehicles, stations };
}
