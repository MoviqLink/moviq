import type { LiveStation } from '@moviq/contracts';
import type { ComponentProps } from 'react';
import { Overview } from '../ui/Overview';
import { DestinationPanel, destinationOf } from './DestinationPanel';

type Props = ComponentProps<typeof Overview> & { readonly stations: readonly LiveStation[] };
export function DestinationOverview(props: Props) {
  const destination = destinationOf(props.destination);
  return destination === null ? (
    <Overview {...props} />
  ) : (
    <DestinationPanel
      key={destination}
      destination={destination}
      live={props.live}
      stations={props.stations}
      vehicles={props.vehicles}
      city={props.city}
      events={props.events}
      onOpen={props.onOpen}
    />
  );
}
