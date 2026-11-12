import { useLang } from '../../shared/i18n/lang';

const s = String;

interface Named {
  readonly name: string;
  readonly what: string;
}

// The credits page's words. Names stay as their holders write them; credit lines and licences stay
// in English, word for word. Spanish has exactly the same keys: TypeScript and the tests check it.
export const creditsEn = {
  title: 'Credits and data sources',
  home: 'MovIQ, home',
  skip: 'Skip to the credits',
  lead:
    'MovIQ reads every source through its own server and shows where each live figure comes ' +
    'from and how old it is. These are the people and organisations behind that data, each with ' +
    'the credit and the licence they ask for.',
  feedsLine:
    'feeds read by our server on their own rhythm, plus routing, flights, addresses and maps ' +
    'asked for when a trip needs them.',
  feeds: (n: number) => (n === 1 ? '1 feed' : `${s(n)} feeds`),
  credit: 'Credit',
  licence: 'Licence',
  newTab: '(opens in a new tab)',
  notice: 'NYC DOT notice',
  noticeLead: 'NYC DOT asks every application that uses its data to carry this text:',
  groups: {
    transit: 'Subway, buses, trains and ferries',
    bikes: 'Bikes and scooters',
    air: 'Flights and airports',
    harbor: 'The harbor',
    streets: 'Streets and the city',
    weather: 'Weather',
    events: 'Events',
    maps: 'Maps, places and pictures',
  },
  credits: {
    mta: { name: 'MTA', what: 'Subway, buses, LIRR and Metro-North, live and timetabled; alerts.' },
    mtaOpenData: { name: 'MTA Open Data', what: 'Stations, entrances and their elevators.' },
    transitous: { name: 'Transitous', what: 'Routes for planning when our own engine has none.' },
    path: { name: 'PATH', what: 'Train arrivals and service alerts.' },
    amtraker: { name: 'Amtraker', what: 'Amtrak trains around New York.' },
    beeLine: { name: 'Bee-Line', what: 'Westchester buses, live and timetabled.' },
    nycFerry: { name: 'NYC Ferry', what: 'Boats, timetables, predictions and alerts.' },
    nyWaterway: { name: 'NY Waterway', what: 'Boats, timetables and alerts.' },
    statenIslandFerry: { name: 'Staten Island Ferry', what: 'The timetable, from NYC DOT.' },
    airportShuttles: { name: 'Airport shuttles', what: 'JFK, LaGuardia and Newark shuttles.' },
    passioGo: { name: 'Passio GO', what: 'University and district shuttles.' },
    bikeShare: { name: 'Bike share', what: 'Stations, bikes and free docks.' },
    bird: { name: 'Bird', what: 'Scooters in Queens and the Bronx.' },
    lime: { name: 'Lime', what: 'Scooters in the Bronx and Queens.' },
    veo: { name: 'Veo', what: 'E-bikes and scooters in the Bronx and Queens.' },
    aeroDataBox: { name: 'AeroDataBox', what: 'Flight status and airport boards.' },
    faa: { name: 'FAA', what: 'Delays, ground stops and closures at the airports.' },
    adsbLol: { name: 'adsb.lol', what: 'Aircraft positions.' },
    adsbFi: { name: 'adsb.fi', what: 'Aircraft positions, when adsb.lol is down.' },
    virtualRadar: { name: 'Virtual Radar Server', what: 'The usual route of each flight.' },
    openWaters: { name: 'Open Waters', what: 'Ships in New York Harbor (AIS).' },
    noaaPorts: { name: 'NOAA PORTS', what: 'Water level, currents, wind and bridge clearance.' },
    coastGuard: { name: 'U.S. Coast Guard', what: 'Notices to mariners, Sector New York.' },
    pnct: { name: 'PNCT', what: 'Container ships due at Port Newark.' },
    ny511: { name: '511NY', what: 'Incidents, closures, roadwork, cameras and crossing times.' },
    nycDot: { name: 'NYC Open Data · NYC DOT', what: 'Traffic speeds, parking and street works.' },
    plowNyc: { name: 'PlowNYC', what: 'Snow plows at work.' },
    defibrillators: { name: 'NYC Open Data · Health', what: 'Public defibrillators.' },
    restrooms: { name: 'NYC Open Data · Restrooms', what: 'Free public restrooms in service.' },
    landmarks: {
      name: 'NYC Landmarks Preservation Commission',
      what: 'Officially designated individual landmark sites.',
    },
    chargersNy: { name: 'data.ny.gov', what: 'Electric car chargers in New York.' },
    chargersNj: { name: 'Alternative Fuels Data Center', what: 'Chargers on the New Jersey side.' },
    recorder: { name: 'MovIQ recorder', what: 'Reliability measured from what it records.' },
    nws: { name: 'NOAA and NWS', what: 'Weather alerts, the hourly forecast and the radar.' },
    ticketmaster: { name: 'Ticketmaster', what: 'Concerts, games and shows.' },
    nycEvents: {
      name: 'NYC Open Data · Events',
      what: 'Parks events and permitted street events.',
    },
    venues: { name: 'Venue websites', what: 'Brooklyn Paramount and Irving Plaza listings.' },
    openStreetMap: { name: 'OpenStreetMap', what: 'Streets, places and paths on every map.' },
    openFreeMap: { name: 'OpenFreeMap', what: 'The map tiles and their light and dark styles.' },
    naturalEarth: { name: 'Natural Earth', what: 'The relief of the map from far away.' },
    aerialBase: { name: 'USGS', what: 'Regional aerial imagery; acquisition dates vary by area.' },
    aerial: {
      name: 'NYS ITS',
      what: 'Street-level aerial detail of the five boroughs, spring 2024.',
    },
    geoSearch: { name: 'NYC GeoSearch', what: 'New York addresses for Sara.' },
    photo: { name: 'Pierre Blaché', what: 'The home page photo, via Wikimedia Commons.' },
  } satisfies Record<string, Named>,
};

export type CreditsDict = typeof creditsEn;

export const creditsEs: CreditsDict = {
  title: 'Créditos y fuentes de datos',
  home: 'MovIQ, inicio',
  skip: 'Saltar a los créditos',
  lead:
    'MovIQ lee cada fuente desde su propio servidor y dice de dónde sale cada dato en directo y ' +
    'qué antigüedad tiene. Estas son las personas y organizaciones detrás de esos datos, cada una ' +
    'con el crédito y la licencia que pide.',
  feedsLine:
    'fuentes que nuestro servidor lee a su propio ritmo, además de rutas, vuelos, direcciones y ' +
    'mapas que se piden cuando un viaje los necesita.',
  feeds: (n: number) => (n === 1 ? '1 fuente' : `${s(n)} fuentes`),
  credit: 'Crédito',
  licence: 'Licencia',
  newTab: '(se abre en una pestaña nueva)',
  notice: 'Aviso de NYC DOT',
  noticeLead: 'NYC DOT pide a toda aplicación que use sus datos que incluya este texto:',
  groups: {
    transit: 'Metro, buses, trenes y ferris',
    bikes: 'Bicis y patinetes',
    air: 'Vuelos y aeropuertos',
    harbor: 'El puerto',
    streets: 'Calles y ciudad',
    weather: 'Tiempo',
    events: 'Eventos',
    maps: 'Mapas, lugares e imágenes',
  },
  credits: {
    mta: {
      name: 'MTA',
      what: 'Metro, buses, LIRR y Metro-North, en directo y por horario; avisos.',
    },
    mtaOpenData: { name: 'MTA Open Data', what: 'Estaciones, accesos y sus ascensores.' },
    transitous: {
      name: 'Transitous',
      what: 'Rutas para planificar cuando nuestro motor no tiene.',
    },
    path: { name: 'PATH', what: 'Llegadas de trenes y avisos del servicio.' },
    amtraker: { name: 'Amtraker', what: 'Trenes de Amtrak alrededor de Nueva York.' },
    beeLine: { name: 'Bee-Line', what: 'Buses de Westchester, en directo y por horario.' },
    nycFerry: { name: 'NYC Ferry', what: 'Barcos, horarios, predicciones y avisos.' },
    nyWaterway: { name: 'NY Waterway', what: 'Barcos, horarios y avisos.' },
    statenIslandFerry: { name: 'Staten Island Ferry', what: 'El horario, de NYC DOT.' },
    airportShuttles: { name: 'Lanzaderas de aeropuerto', what: 'JFK, LaGuardia y Newark.' },
    passioGo: { name: 'Passio GO', what: 'Lanzaderas de universidades y distritos.' },
    bikeShare: { name: 'Bicicleta compartida', what: 'Estaciones, bicis y anclajes libres.' },
    bird: { name: 'Bird', what: 'Patinetes en Queens y el Bronx.' },
    lime: { name: 'Lime', what: 'Patinetes en el Bronx y Queens.' },
    veo: { name: 'Veo', what: 'Bicis eléctricas y patinetes en el Bronx y Queens.' },
    aeroDataBox: { name: 'AeroDataBox', what: 'Estado de los vuelos y paneles de aeropuerto.' },
    faa: { name: 'FAA', what: 'Retrasos, paradas en tierra y cierres en los aeropuertos.' },
    adsbLol: { name: 'adsb.lol', what: 'Posiciones de los aviones.' },
    adsbFi: { name: 'adsb.fi', what: 'Posiciones de los aviones, cuando adsb.lol falla.' },
    virtualRadar: { name: 'Virtual Radar Server', what: 'La ruta habitual de cada vuelo.' },
    openWaters: { name: 'Open Waters', what: 'Barcos en el puerto de Nueva York (AIS).' },
    noaaPorts: {
      name: 'NOAA PORTS',
      what: 'Nivel del agua, corrientes, viento y gálibo del puente.',
    },
    coastGuard: {
      name: 'Guardia Costera de EE. UU.',
      what: 'Avisos a navegantes, sector de Nueva York.',
    },
    pnct: { name: 'PNCT', what: 'Portacontenedores previstos en Port Newark.' },
    ny511: { name: '511NY', what: 'Incidencias, cortes, obras, cámaras y tiempos de los cruces.' },
    nycDot: {
      name: 'NYC Open Data · NYC DOT',
      what: 'Velocidades del tráfico, aparcamiento y obras.',
    },
    plowNyc: { name: 'PlowNYC', what: 'Quitanieves trabajando.' },
    defibrillators: { name: 'NYC Open Data · Salud', what: 'Desfibriladores públicos.' },
    restrooms: { name: 'NYC Open Data · Aseos', what: 'Aseos públicos gratuitos en servicio.' },
    landmarks: {
      name: 'NYC Landmarks Preservation Commission',
      what: 'Lugares protegidos con designación oficial individual.',
    },
    chargersNy: { name: 'data.ny.gov', what: 'Cargadores de coches eléctricos en Nueva York.' },
    chargersNj: {
      name: 'Alternative Fuels Data Center',
      what: 'Cargadores en el lado de Nueva Jersey.',
    },
    recorder: { name: 'Grabadora de MovIQ', what: 'Fiabilidad medida con lo que graba.' },
    nws: { name: 'NOAA y NWS', what: 'Avisos meteorológicos, la previsión por horas y el radar.' },
    ticketmaster: { name: 'Ticketmaster', what: 'Conciertos, partidos y espectáculos.' },
    nycEvents: {
      name: 'NYC Open Data · Eventos',
      what: 'Eventos de los parques y en la calle con permiso.',
    },
    venues: {
      name: 'Webs de las salas',
      what: 'Programación de Brooklyn Paramount e Irving Plaza.',
    },
    openStreetMap: { name: 'OpenStreetMap', what: 'Calles, lugares y caminos de todos los mapas.' },
    openFreeMap: {
      name: 'OpenFreeMap',
      what: 'Las teselas del mapa y sus estilos claro y oscuro.',
    },
    naturalEarth: { name: 'Natural Earth', what: 'El relieve del mapa visto de lejos.' },
    aerialBase: {
      name: 'USGS',
      what: 'Base aérea regional; la fecha de captura varía según la zona.',
    },
    aerial: { name: 'NYS ITS', what: 'Detalle aéreo de los cinco distritos, primavera de 2024.' },
    geoSearch: { name: 'NYC GeoSearch', what: 'Direcciones de Nueva York para Sara.' },
    photo: { name: 'Pierre Blaché', what: 'La foto de la portada, desde Wikimedia Commons.' },
  },
};

/** The credits page's words in the language in use. */
export function useCreditsT(): CreditsDict {
  return useLang() === 'es' ? creditsEs : creditsEn;
}
