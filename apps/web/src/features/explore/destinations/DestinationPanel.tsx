import type { LiveStation, LiveVehicle } from '@moviq/contracts';
import { useState } from 'react';
import type { CityLayersView } from '../city/useCityLayers';
import { EventsPanel } from '../events/ui/EventsPanel';
import type { EventLayer } from '../events/useEvents';
import type { LiveCityView } from '../live/useLiveCity';
import { CityItems } from './CityItems';
import { StationSection } from './StationSection';
import { useDestinationT } from './texts';
import './destinations.css';

export type Destination = 'stations' | 'incidents' | 'traffic' | 'tourist';
export function destinationOf(value: string | null): Destination | null {
  return value === 'stations' || value === 'incidents' || value === 'traffic' || value === 'tourist'
    ? value
    : null;
}
export function DestinationPanel({
  destination,
  live,
  stations,
  vehicles,
  city,
  events,
  onOpen,
}: {
  destination: Destination;
  live: LiveCityView;
  stations: readonly LiveStation[];
  vehicles: readonly LiveVehicle[];
  city: CityLayersView;
  events: EventLayer;
  onOpen: (id: string) => void;
}) {
  const t = useDestinationT();
  const [query, setQuery] = useState('');
  const layers =
    destination === 'incidents'
      ? (['incidents', 'transit-alerts'] as const)
      : destination === 'traffic'
        ? (['cameras', 'incidents', 'closures'] as const)
        : (['landmarks'] as const);
  return (
    <section className="destination" id={`explore-${destination}`} tabIndex={-1}>
      <header>
        <p className="destination-kicker">MovIQ · New York</p>
        <h1>{t[destination]}</h1>
        <p>{t[`${destination}Lead`]}</p>
      </header>
      <label htmlFor="destination-search">{t.search[destination]}</label>
      <input
        id="destination-search"
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      {destination === 'stations' ? (
        <StationSection
          live={live}
          stations={stations}
          vehicles={vehicles}
          city={city}
          query={query}
          onOpen={onOpen}
        />
      ) : (
        <>
          {destination === 'tourist' && <EventsPanel layer={events} onOpen={onOpen} />}
          {destination === 'tourist' && <h2>{t.landmarks}</h2>}
          <CityItems city={city} layers={layers} query={query} onOpen={onOpen} />
        </>
      )}
    </section>
  );
}
