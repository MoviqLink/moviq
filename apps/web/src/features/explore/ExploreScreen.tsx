import type { BoundingBox, LiveVehiclesResponse } from '@moviq/contracts';
import type { ComponentProps } from 'react';

import type { useVirtualRide } from '../virtual/useVirtualRide';

import { CityCard, sourceOf } from './city/ui/CityCard';
import type { CityLayersView } from './city/useCityLayers';
import { DestinationOverview } from './destinations/DestinationOverview';
import { destinationOf } from './destinations/DestinationPanel';
import { EventCard } from './events/ui/EventCard';
import type { useEventsOnMap, EventLayer } from './events/useEvents';
import type { Selection } from './live/useShownCity';
import { useExploreData } from './live/useExploreData';
import { YourMap } from './ui/YourMap';
import { ExploreStage, virtualCard } from './ui/ExploreStage';
import { StationCard } from './ui/StationCard';
import { VehicleCard } from './ui/VehicleCard';
import './explore.css';
import './explore-modes.css';
import './events/events.css';
import './city/city.css';

function Card({
  selection,
  data,
  now,
  onClose,
  onBoard,
  boarding,
  boardingFailed,
}: {
  selection: Selection;
  data: LiveVehiclesResponse | null;
  now: number;
  onClose: () => void;
  onBoard: (id: string) => void;
  boarding: boolean;
  boardingFailed: boolean;
}) {
  const source = data?.sources.find(
    (candidate) => candidate.provenance.sourceId === selection.item.sourceId,
  );
  return selection.kind === 'vehicle' ? (
    <VehicleCard
      vehicle={selection.item}
      source={source}
      lost={selection.lost}
      now={now}
      onClose={onClose}
      onBoard={onBoard}
      boarding={boarding}
      boardingFailed={boardingFailed}
    />
  ) : (
    <StationCard station={selection.item} source={source} now={now} onClose={onClose} />
  );
}

/** The card of a city item, its source from the layers answer or from the parking signs. */
function cityCardOf(city: CityLayersView, id: string | null, now: number, onClose: () => void) {
  const item = id === null ? undefined : city.items.find((candidate) => candidate.id === id);
  if (item === undefined || !city.on.has(item.layer)) return null;
  const signs = city.signs?.source;
  const source =
    item.layer === 'parking-signs' && signs !== undefined
      ? { title: signs.title, attribution: signs.attribution, age: null }
      : sourceOf(city.data?.sources ?? [], item.sourceId);
  return <CityCard item={item} source={source} now={now} onClose={onClose} />;
}

const centerOf = (box: BoundingBox): readonly [number, number] => [
  (box[0] + box[2]) / 2,
  (box[1] + box[3]) / 2,
];

function selectedCard(
  event: ReturnType<typeof useEventsOnMap>['selected'],
  events: EventLayer,
  selection: Selection | null,
  city: CityLayersView,
  id: string | null,
  data: LiveVehiclesResponse | null,
  now: number,
  close: () => void,
  onBoard: (id: string) => void,
  boarding: boolean,
  boardingFailed: boolean,
) {
  return event !== undefined ? (
    <EventCard event={event} answer={events.data} now={now} onClose={close} />
  ) : selection === null ? (
    cityCardOf(city, id, now, close)
  ) : (
    <Card
      selection={selection}
      data={data}
      now={now}
      onClose={close}
      onBoard={onBoard}
      boarding={boarding}
      boardingFailed={boardingFailed}
    />
  );
}

const boardRide =
  (virtual: ReturnType<typeof useVirtualRide>, engage: (value: boolean) => void) =>
  (id: string) => {
    engage(true);
    void virtual.board(id);
  };

function MapOverview({
  normalMap,
  your,
  destination,
}: {
  normalMap: boolean;
  your: ComponentProps<typeof YourMap>;
  destination: ComponentProps<typeof DestinationOverview>;
}) {
  return normalMap ? <YourMap {...your} /> : <DestinationOverview {...destination} />;
}

function PageOverview({ data }: { data: ReturnType<typeof useExploreData> }) {
  const {
    normalMap,
    choice,
    catalog,
    vehicles,
    now,
    city,
    radar,
    box,
    eventLayer,
    setSelectedId,
    close,
    viewTarget,
    live,
    hidden,
    stations,
    toggle,
  } = data;
  return (
    <MapOverview
      normalMap={normalMap}
      your={{
        choice,
        catalog,
        vehicles,
        now,
        city,
        radar,
        box,
        events: eventLayer,
        onOpen: setSelectedId,
        onRemove: (line) => {
          choice.remove(line);
          close();
        },
        onToggleOther: (mode) => {
          choice.toggleOther(mode);
          close();
        },
      }}
      destination={{
        destination: viewTarget,
        live,
        city,
        radar,
        box,
        hidden,
        vehicles,
        stations,
        now,
        events: eventLayer,
        onToggle: toggle,
        center: centerOf(box),
        onOpen: setSelectedId,
      }}
    />
  );
}

/** Explore: every vehicle of the city that can be followed, live, on a 2D or aerial map. */
export function ExploreScreen() {
  const data = useExploreData();
  const {
    t,
    viewTarget,
    touristVehicles,
    virtual,
    virtualActive,
    setRideEngaged,
    dark,
    wide,
    now,
    setBox,
    view,
    setView,
    selectedId,
    setSelectedId,
    close,
    live,
    selection,
    vehicles,
    stations,
    eventLayer,
    events,
    event,
    city,
    radar,
  } = data;
  const overview = <PageOverview data={data} />;
  const regularCard = selectedCard(
    event,
    eventLayer,
    selection,
    city,
    selectedId,
    live.data,
    now,
    close,
    boardRide(virtual, setRideEngaged),
    virtual.busy,
    virtual.failed,
  );
  const destination = destinationOf(viewTarget);
  const visibleVirtual = virtualActive ? virtual : { ...virtual, ride: null };
  return (
    <ExploreStage
      overview={overview}
      card={destination === null ? virtualCard(visibleVirtual, regularCard) : regularCard}
      viewTarget={viewTarget}
      virtual={visibleVirtual}
      touristVehicles={touristVehicles}
      view={view}
      setView={setView}
      selectedId={selectedId}
      mapProps={{
        vehicles,
        follow:
          destination === null &&
          visibleVirtual.ride?.status === 'following' &&
          !visibleVirtual.failed
            ? visibleVirtual.ride.vehicle
            : null,
        stations,
        events,
        city: city.drawn,
        radarAskedAt: radar.askedAt,
        selected:
          destination === null ? (visibleVirtual.ride?.vehicle.id ?? selectedId) : selectedId,
        view,
        dark,
        wide,
        label: t.map,
        failedText: t.mapFailed,
        photoCredit: t.photoCredit,
        onSelect: setSelectedId,
        onBounds: setBox,
      }}
    />
  );
}
