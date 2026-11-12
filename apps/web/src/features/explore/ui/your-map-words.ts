import type { LiveLine } from '@moviq/contracts';
import type { useLineCatalog } from '../live/useLineCatalog';
type Catalog = ReturnType<typeof useLineCatalog>;

export const WORDS = {
  en: {
    title: 'Your map',
    intro:
      'The city live: every subway train, regional train, ferry and shuttle followed now. ' +
      'Search a line to focus on it.',
    cityNow: 'Followed now in the city',
    onMapNow: 'On the map',
    byRoute: 'Zoom in to a neighbourhood or search a route to see its buses',
    status: {
      live: 'Live',
      degraded: 'Partly live',
      unavailable: 'Unavailable',
      'not-connected': 'Not connected',
    },
    search: 'Search lines',
    placeholder: 'Line number or name',
    mode: 'Transport mode',
    all: 'All transport',
    results: 'Search results',
    more: 'Show more',
    shown: (visible: number, total: number) => `${String(visible)} of ${String(total)} lines`,
    noMatches: 'No lines match this search.',
    onMap: 'On your map',
    add: 'Add',
    remove: 'Remove',
    other: 'Other transport',
    layers: 'Events and city layers',
    vehicles: 'View vehicles',
    noVehicles: 'No vehicles now',
    noSource: 'Source unavailable',
    inView: 'in view',
    city: 'on the network',
    noView: 'No vehicles in this area; move the map to explore.',
    failed: 'Could not refresh lines.',
    loading: 'Loading lines…',
    label: 'Line catalogue',
  },
  es: {
    title: 'Tu mapa',
    intro:
      'La ciudad en directo: todos los metros, trenes regionales, ferris y lanzaderas que se ' +
      'siguen ahora. Busca una línea para centrarte en ella.',
    cityNow: 'Se siguen ahora en la ciudad',
    onMapNow: 'En el mapa',
    byRoute: 'Acerca el mapa a un barrio o busca una ruta para ver sus autobuses',
    status: {
      live: 'En directo',
      degraded: 'En directo en parte',
      unavailable: 'No disponible',
      'not-connected': 'Sin conectar',
    },
    search: 'Buscar líneas',
    placeholder: 'Número o nombre de línea',
    mode: 'Tipo de transporte',
    all: 'Todos los transportes',
    results: 'Resultados de búsqueda',
    more: 'Mostrar más',
    shown: (visible: number, total: number) => `${String(visible)} de ${String(total)} líneas`,
    noMatches: 'No hay líneas que coincidan.',
    onMap: 'En tu mapa',
    add: 'Añadir',
    remove: 'Quitar',
    other: 'Otros transportes',
    layers: 'Eventos y capas urbanas',
    vehicles: 'Ver vehículos',
    noVehicles: 'Sin vehículos ahora',
    noSource: 'Fuente no disponible',
    inView: 'en esta zona',
    city: 'en la red',
    noView: 'No hay vehículos en esta zona; mueve el mapa para explorar.',
    failed: 'No se pudieron actualizar las líneas.',
    loading: 'Cargando líneas…',
    label: 'Catálogo de líneas',
  },
} as const;

const NETWORK_NAMES: Readonly<Record<string, string>> = {
  'mta-bus-positions': 'MTA Bus',
  'mta-lirr-realtime': 'LIRR',
  'mta-metro-north-realtime': 'Metro-North',
  'nyc-ferry-positions': 'NYC Ferry',
  'ny-waterway-positions': 'NY Waterway',
  'ewr-shuttle-positions': 'Newark Liberty',
  'jfk-lga-shuttle-positions': 'JFK / LaGuardia',
  'passio-go-shuttles': 'Passio GO',
};

export function network(line: LiveLine, catalog: Catalog): string {
  if (line.sourceId.startsWith('mta-subway-')) return 'MTA';
  const name = NETWORK_NAMES[line.sourceId];
  if (name !== undefined) return name;
  const source = catalog.data?.sources.find((item) => item.provenance.sourceId === line.sourceId);
  return source?.title ?? line.sourceId;
}
