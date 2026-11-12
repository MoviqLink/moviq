import { createHash } from 'node:crypto';

import type { SourceState } from '@moviq/contracts';

import type { SourceDefinition } from '../../data-platform/definition.js';
import type { SourceReader, SourceReading } from '../../data-platform/reader.js';
import { mtaElevatorEquipment } from '../../data-platform/sources/accessibility/elevator-equipment.js';
import { mtaElevatorInventory } from '../../data-platform/sources/accessibility/elevator-inventory.js';
import { mtaSubwayEntrances } from '../../data-platform/sources/accessibility/subway-entrances.js';
import { mtaSubwayStations } from '../../data-platform/sources/accessibility/subway-stations.js';
import { busSources } from '../../data-platform/sources/mta/bus-realtime.js';
import { mtaElevators } from '../../data-platform/sources/mta/elevators.js';
import { gtfsStaticSources } from '../../data-platform/sources/mta/gtfs-static.js';
import type { GtfsIndex } from '../../data-platform/sources/mta/gtfs-static-schema.js';
import { subwaySources } from '../../data-platform/sources/mta/subway-realtime.js';
import type {
  EngineSources,
  LivePredictions,
  PlanWindow,
  PredictionReading,
  TimetableInput,
  TimetableReading,
  WheelchairBoarding,
} from './inputs.js';
import { SUBWAY_TIMETABLE, busPredictions, subwayPredictions } from './live-sources.js';
import { stepFreeStops } from './step-free.js';
import { checkedTimetable, stopTimesProblem, wheelchairBoardingOf } from './timetable-input.js';

/** Step-free data is used only while every part of it is fresh enough to trust. */
const TRUSTED: ReadonlySet<SourceState> = new Set(['healthy', 'degraded']);

const [, busTripUpdates] = busSources;

/** What is worked out once per version: whether the stop times decode, and step-free stops. */
type Checked =
  | {
      readonly ok: true;
      readonly wheelchairBoarding: Readonly<Record<string, WheelchairBoarding>>;
      readonly access: Pick<TimetableInput, 'complexes' | 'entrances'>;
    }
  | { readonly ok: false; readonly detail: string };

export function trusted<T>(reading: SourceReading<T>): T | undefined {
  return TRUSTED.has(reading.provenance.state) ? reading.data : undefined;
}

/**
 * The subway's step-free stops for one trip, if every source is there, and a key that changes
 * only when they do: the versions of the station, equipment, inventory and entrance lists, and
 * the stations closed or unknown for the trip's window.
 */
interface StepFreeReading {
  readonly key: string;
  readonly stops: Readonly<Record<string, WheelchairBoarding>> | undefined;
  readonly access: Pick<TimetableInput, 'complexes' | 'entrances'>;
}

const NO_STEP_FREE: StepFreeReading = {
  key: 'none',
  stops: undefined,
  access: { complexes: {}, entrances: {} },
};

async function readStepFree(
  reader: SourceReader,
  subway: GtfsIndex | undefined,
  window: PlanWindow,
): Promise<StepFreeReading> {
  const [stations, equipment, inventory, outages, entrances] = await Promise.all([
    reader.read(mtaSubwayStations),
    reader.read(mtaElevatorEquipment),
    reader.read(mtaElevatorInventory),
    reader.read(mtaElevators),
    reader.read(mtaSubwayEntrances),
  ]);
  const sources = {
    stations: trusted(stations),
    equipment: trusted(equipment),
    inventory: trusted(inventory),
    outages: trusted(outages),
    entrances: trusted(entrances),
  };
  const { stations: list, equipment: pieces, inventory: kept, outages: out } = sources;
  if (subway === undefined || list === undefined || pieces === undefined) return NO_STEP_FREE;
  if (kept === undefined || out === undefined || sources.entrances === undefined) {
    return NO_STEP_FREE;
  }
  const stepFree = stepFreeStops(
    subway,
    {
      stations: list,
      equipment: pieces,
      inventory: kept,
      outages: out,
      entrances: sources.entrances,
    },
    window,
  );
  // An elevator out that cannot be placed could be on any path: then no station is step-free.
  if (stepFree.unmatched.length > 0) return NO_STEP_FREE;
  const shut = `${stepFree.closed.join(',')}/${stepFree.unknown.join(',')}`;
  const hash = createHash('sha256').update(shut).digest('hex').slice(0, 8);
  const versions = [stations, equipment, inventory, entrances].map(
    (reading) => reading.version ?? '-',
  );
  const access = { complexes: stepFree.complexes, entrances: stepFree.entrances };
  return { key: `${versions.join('.')}.${hash}`, stops: stepFree.stops, access };
}

/** The check of each source, kept while its key (version and step-free data) stays the same. */
function checkCache(): (sourceId: string, key: string, check: () => Checked) => Checked {
  const kept = new Map<string, { readonly key: string; readonly checked: Checked }>();
  return (sourceId, key, check) => {
    const found = kept.get(sourceId);
    if (found?.key === key) return found.checked;
    const checked = check();
    kept.set(sourceId, { key, checked });
    return checked;
  };
}

function check(index: GtfsIndex, stepFree: StepFreeReading | undefined): Checked {
  const detail = stopTimesProblem(index);
  if (detail !== undefined) return { ok: false, detail };
  return {
    ok: true,
    wheelchairBoarding: wheelchairBoardingOf(index, stepFree?.stops ?? {}),
    access: stepFree?.access ?? NO_STEP_FREE.access,
  };
}

function timetableReading(
  definition: SourceDefinition<GtfsIndex>,
  reading: SourceReading<GtfsIndex>,
  version: string | undefined,
  checked: Checked | undefined,
): TimetableReading {
  const { provenance, data } = reading;
  if (checked?.ok === true && data !== undefined) {
    const timetable = checkedTimetable(data, checked.wheelchairBoarding, checked.access);
    return { sourceId: definition.id, version, provenance, timetable };
  }
  const refused =
    checked?.ok === false
      ? { ...provenance, state: 'unavailable' as const, evidence: checked.detail }
      : provenance;
  return { sourceId: definition.id, version: undefined, provenance: refused, timetable: undefined };
}

function predictionReading<T>(
  sourceId: string,
  reading: SourceReading<T>,
  toPredictions: (data: T) => LivePredictions,
): PredictionReading {
  const predictions = reading.data === undefined ? undefined : toPredictions(reading.data);
  return { sourceId, provenance: reading.provenance, predictions };
}

/**
 * The engine's port over the data platform: the seven MTA timetables, checked once per version,
 * the subway with its step-free stations and elevators, and the eight subway feeds and Bus Time.
 * The subway's version names the step-free data too, so the engine compiles again when it changes.
 */
export function platformEngineSources(reader: SourceReader): EngineSources {
  const checked = checkCache();
  return {
    async readTimetables(window) {
      const readings = await Promise.all(
        gtfsStaticSources.map(async (definition) => ({
          definition,
          reading: await reader.read(definition),
        })),
      );
      const subway = readings.find(({ definition }) => definition.id === SUBWAY_TIMETABLE);
      const access = await readStepFree(reader, subway?.reading.data, window);
      return readings.map(({ definition, reading }) => {
        const isSubway = definition.id === SUBWAY_TIMETABLE;
        const version =
          isSubway && reading.version !== undefined
            ? `${reading.version}+step-free.${access.key}`
            : reading.version;
        const index = reading.data;
        const stepFree = isSubway ? access : undefined;
        const outcome =
          index === undefined || version === undefined
            ? undefined
            : checked(definition.id, version, () => check(index, stepFree));
        return timetableReading(definition, reading, version, outcome);
      });
    },
    async readPredictions() {
      const subway = await Promise.all(
        subwaySources.map(async (definition) =>
          predictionReading(definition.id, await reader.read(definition), subwayPredictions),
        ),
      );
      const buses = await reader.read(busTripUpdates);
      return [...subway, predictionReading(busTripUpdates.id, buses, busPredictions)];
    },
  };
}
