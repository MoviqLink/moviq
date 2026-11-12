import { useLang } from '../../../shared/i18n/lang';
const words = {
  en: {
    stations: 'Stations and lines',
    stationsLead:
      'Search stations and subway entrances in the map area. Lines are those currently seen on ' +
      'vehicles, not a complete directory.',
    incidents: 'Incidents',
    incidentsLead: 'Published road incidents and transit alerts in the map area.',
    traffic: 'Traffic',
    trafficLead: 'Traffic cameras, reported road incidents and closures in the map area.',
    tourist: 'Tourist mode',
    touristLead:
      'Explore published events and designated landmarks. Landmark designation does not guarantee ' +
      'public access or visiting hours. Tourist experiences are not available here yet.',
    search: {
      stations: 'Search stations or lines',
      incidents: 'Search incidents',
      traffic: 'Search roads or cameras',
      tourist: 'Search landmarks',
    },
    lines: 'Lines seen on the map',
    stops: 'Stations and entrances',
    landmarks: 'Designated landmarks',
    none: 'No matching items in this map area.',
    loading: 'Reading the sources…',
    failed: 'The latest update failed; previously received data may be out of date.',
    unavailable: 'Source unavailable; absence of data does not mean there are no incidents.',
    incomplete:
      'Some source data is incomplete or out of date; absence of results is not conclusive.',
    limit: 'Showing the first results. Search or move the map to narrow them.',
    citywide: 'citywide',
    missingModes: 'Some transport sources are unavailable',
    observed: 'Select to view a vehicle on this line',
    unknown: 'No source information',
    states: {
      healthy: 'Up to date',
      degraded: 'Degraded',
      stale: 'Out of date',
      unavailable: 'Unavailable',
      rate_limited: 'Rate limited',
      misconfigured: 'Not configured',
      outside_service: 'Outside service',
      unknown: 'Unknown',
    },
  },
  es: {
    stations: 'Estaciones y líneas',
    stationsLead:
      'Busca estaciones y entradas de metro en la zona del mapa. Las líneas son las observadas ' +
      'ahora en vehículos, no un directorio completo.',
    incidents: 'Incidencias',
    incidentsLead:
      'Incidencias de carretera y avisos de transporte publicados en la zona del mapa.',
    traffic: 'Tránsito',
    trafficLead: 'Cámaras de tráfico, incidencias y cortes publicados en la zona del mapa.',
    tourist: 'Modo turista',
    touristLead:
      'Explora eventos publicados y monumentos protegidos. La protección no garantiza acceso ' +
      'público ni horario de visita. Las experiencias turísticas aún no están disponibles aquí.',
    search: {
      stations: 'Buscar estaciones o líneas',
      incidents: 'Buscar incidencias',
      traffic: 'Buscar vías o cámaras',
      tourist: 'Buscar monumentos',
    },
    lines: 'Líneas observadas en el mapa',
    stops: 'Estaciones y entradas',
    landmarks: 'Monumentos protegidos',
    none: 'No hay resultados para esta zona del mapa.',
    loading: 'Consultando las fuentes…',
    failed:
      'La última actualización ha fallado; los datos anteriores pueden estar desactualizados.',
    unavailable: 'Fuente no disponible; la falta de datos no significa que no haya incidencias.',
    incomplete:
      'Algunos datos de las fuentes están incompletos o desactualizados; no se puede concluir que no haya resultados.',
    limit: 'Se muestran los primeros resultados. Busca o mueve el mapa para acotarlos.',
    citywide: 'en toda la ciudad',
    missingModes: 'Algunas fuentes de transporte no están disponibles',
    observed: 'Selecciona para ver un vehículo de esta línea',
    unknown: 'Sin información de fuente',
    states: {
      healthy: 'Actualizada',
      degraded: 'Degradada',
      stale: 'Desactualizada',
      unavailable: 'No disponible',
      rate_limited: 'Límite de consultas',
      misconfigured: 'Sin configurar',
      outside_service: 'Fuera de servicio',
      unknown: 'Desconocida',
    },
  },
} as const;
export function useDestinationT() {
  return words[useLang()];
}
