import type { CityItem } from '@moviq/contracts';

import type { SourceDefinition } from '../../data-platform/definition.js';
import { mtaSubwayEntrances } from '../../data-platform/sources/accessibility/subway-entrances.js';
import { afdcNewJerseyChargers } from '../../data-platform/sources/street/afdc-chargers.js';
import { nycDefibrillators } from '../../data-platform/sources/street/defibrillators.js';
import {
  nycEvChargers,
  type ChargingStation,
} from '../../data-platform/sources/street/ev-chargers.js';
import { nycLandmarks } from '../../data-platform/sources/street/landmarks.js';
import { nycParkingMeters } from '../../data-platform/sources/street/parking-meters.js';
import { nycPublicRestrooms } from '../../data-platform/sources/street/public-restrooms.js';
import { pointPlace } from '../geometry.js';
import { layerOf, part, type CityLayer } from '../layer.js';

/** Both lists share the AFDC station ids, and neither lists a station of the other. */
function chargerPart<T extends { readonly stations: readonly ChargingStation[] }>(
  source: SourceDefinition<T>,
) {
  return part({
    source,
    items: (data): CityItem[] =>
      data.stations.map((station) => ({
        id: `chargers:${station.id}`,
        layer: 'chargers',
        sourceId: source.id,
        title: station.name,
        ...pointPlace(station.point),
        detail: {
          kind: 'charger',
          address: `${station.address}, ${station.city}`,
          listing: station.listing,
          access: station.access,
          hours: station.hours,
          ports: {
            level1: station.level1Ports,
            level2: station.level2Ports,
            fast: station.fastPorts,
          },
          network: station.network,
          connectors: station.connectors.filter((connector) => connector !== ''),
          pricing: station.pricing,
          confirmedOn: station.confirmedOn,
        },
      })),
  });
}

/** Charging stations as listed: open, planned or temporarily unavailable, never free or in use. */
const chargers = layerOf('chargers', 'places', [
  chargerPart(nycEvChargers),
  chargerPart(afdcNewJerseyChargers),
]);

/** Defibrillators of the city's inventory: who has it, where inside and how many, no hours. */
const defibrillators = layerOf('defibrillators', 'places', [
  part({
    source: nycDefibrillators,
    items: (data): CityItem[] =>
      data.defibrillators.map((unit) => ({
        id: `defibrillators:${unit.point.join(',')}:${unit.entity}:${unit.place ?? ''}`,
        layer: 'defibrillators',
        sourceId: nycDefibrillators.id,
        title: unit.entity,
        ...pointPlace(unit.point),
        detail: {
          kind: 'defibrillator',
          address: unit.address,
          place: unit.place,
          units: unit.units,
          locationType: unit.locationType,
          updatedOn: unit.updatedOn,
        },
      })),
  }),
]);

/** Public restrooms in service, all free, with their hours as published, never "open now". */
const restrooms = layerOf('restrooms', 'places', [
  part({
    source: nycPublicRestrooms,
    items: (data): CityItem[] =>
      data.restrooms.map((restroom) => ({
        id: `restrooms:${restroom.point.join(',')}:${restroom.name}`,
        layer: 'restrooms',
        sourceId: nycPublicRestrooms.id,
        title: restroom.name,
        ...pointPlace(restroom.point),
        detail: { kind: 'restroom', ...restroom.facts },
      })),
  }),
]);

/** Individual landmarks as designated by the City's preservation commission. */
const landmarks = layerOf('landmarks', 'places', [
  part({
    source: nycLandmarks,
    items: (data): CityItem[] =>
      data.landmarks.map((item) => ({
        id: `landmarks:${item.id}`,
        layer: 'landmarks',
        sourceId: nycLandmarks.id,
        title: item.name,
        ...pointPlace(item.point),
        detail: {
          kind: 'landmark',
          address: item.address,
          borough: item.borough,
          designatedOn: item.designatedOn,
        },
      })),
  }),
]);

/** Subway entrances of the MTA's 2024 survey: the kind, and whether they let people in or out. */
const subwayEntrances = layerOf('subway-entrances', 'places', [
  part({
    source: mtaSubwayEntrances,
    items: (data): CityItem[] =>
      data.entrances.map((entrance) => ({
        id: `subway-entrances:${entrance.complex}:${entrance.point.join(',')}`,
        layer: 'subway-entrances',
        sourceId: mtaSubwayEntrances.id,
        title: entrance.name,
        ...pointPlace(entrance.point),
        detail: {
          kind: 'subway-entrance',
          type: entrance.type,
          entry: entrance.entry,
          exit: entrance.exit,
        },
      })),
  }),
]);

/** Parking meters in service: `Active` is the meter, never a free space. */
const parkingMeters = layerOf('parking-meters', 'places', [
  part({
    source: nycParkingMeters,
    items: (data): CityItem[] =>
      data.meters.map((meter) => ({
        id: `parking-meters:${meter.id}`,
        layer: 'parking-meters',
        sourceId: nycParkingMeters.id,
        title: meter.street ?? meter.id,
        ...pointPlace(meter.point),
        detail: {
          kind: 'parking-meter',
          hours: meter.hours,
          facility: meter.facility,
          street: meter.street,
          side: meter.side,
          from: meter.from,
          to: meter.to,
        },
      })),
  }),
]);

export const placeLayers: readonly CityLayer[] = [
  chargers,
  defibrillators,
  restrooms,
  landmarks,
  subwayEntrances,
  parkingMeters,
];
