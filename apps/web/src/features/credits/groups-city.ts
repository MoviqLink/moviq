import {
  BOROUGHS,
  CATALOGUE,
  numbered,
  NY511,
  NYC_TERMS,
  ODBL,
  PUBLIC_DOMAIN,
  type CreditGroup,
} from './credit';

// The credits of the city around the trip: streets, weather, events, and the maps and pictures.

export const streets: CreditGroup = {
  id: 'streets',
  credits: [
    {
      id: 'ny511',
      attribution: ['Powered by 511NY'],
      licence: {
        name: '511NY Developer Access Agreement',
        url: 'https://511ny.org/developers/daa',
      },
      sources: NY511.map((layer) => `ny511-${layer}`),
      basis: [CATALOGUE],
    },
    {
      id: 'nycDot',
      attribution: [
        'NYC Department of Transportation, Traffic Speeds (NYC Open Data)',
        'Parking Meters Locations and Status, NYC DOT (NYC Open Data, 693u-uax6)',
        'Parking Regulation Locations and Signs, NYC DOT (NYC Open Data, nfid-uabd)',
        'Street Closures due to construction activities by Block, NYC DOT (NYC Open Data, i6b5-j7bu)',
        'Street Construction Permits, NYC DOT (NYC Open Data, tqtj-sjs8)',
      ],
      licence: NYC_TERMS,
      sources: [
        'nyc-dot-traffic-speeds',
        'nyc-parking-meters',
        'nyc-street-closures-today',
        ...BOROUGHS.map((borough) => `nyc-street-permits-${borough}`),
      ],
      basis: [CATALOGUE, 'apps/server/src/modules/city-layers/parking-signs.ts'],
    },
    {
      id: 'plowNyc',
      attribution: ['Snow clearing data from the NYC Department of Sanitation (PlowNYC)'],
      licence: {
        name: 'PlowNYC disclaimer of the City of New York',
        url: 'https://plownyc.nyc.gov/plownyc/',
      },
      sources: ['plownyc-status'],
      basis: [CATALOGUE],
    },
    {
      id: 'defibrillators',
      attribution: [
        'New York City AED Inventory, NYC Department of Health and Mental Hygiene ' +
          '(NYC Open Data, 2er2-jqsx)',
      ],
      licence: NYC_TERMS,
      sources: ['nyc-defibrillators'],
      basis: [CATALOGUE],
    },
    {
      id: 'restrooms',
      attribution: ['Public Restrooms, City of New York (NYC Open Data, i7jb-7jku)'],
      licence: NYC_TERMS,
      sources: ['nyc-public-restrooms'],
      basis: [CATALOGUE],
    },
    {
      id: 'landmarks',
      attribution: ['NYC Landmarks Preservation Commission, Individual Landmark Sites (buis-pvji)'],
      licence: NYC_TERMS,
      sources: ['nyc-landmarks'],
      basis: [CATALOGUE],
    },
    {
      id: 'chargersNy',
      attribution: [
        'Electric Vehicle Charging Stations in New York, U.S. Department of Energy (data.ny.gov)',
      ],
      licence: {
        name: 'Open NY Terms of Use',
        url: 'https://data.ny.gov/dataset/OPEN-NY-Terms-Of-Use/77gx-ii52',
      },
      sources: ['nyc-ev-chargers'],
      basis: [CATALOGUE],
    },
    {
      id: 'chargersNj',
      attribution: ['Alternative Fuels Data Center, U.S. Department of Energy'],
      licence: {
        name: 'NLR Developer Network terms and conditions',
        url: 'https://developer.nlr.gov/terms/',
      },
      sources: ['afdc-ev-chargers-new-jersey'],
      basis: [CATALOGUE],
    },
    {
      id: 'recorder',
      attribution: ['Reliability measured by MovIQ from MTA and city open data'],
      licence: {
        name: 'Measured by MovIQ from the recorded sources, under their licences',
        url: null,
      },
      sources: ['moviq-recorder-stats'],
      basis: [CATALOGUE],
    },
  ],
};

export const weather: CreditGroup = {
  id: 'weather',
  credits: [
    {
      id: 'nws',
      attribution: [
        'National Weather Service (NOAA)',
        'Radar: NOAA National Weather Service (public domain)',
      ],
      licence: { name: PUBLIC_DOMAIN, url: 'https://www.weather.gov/disclaimer' },
      sources: ['nws-alerts-new-york', 'nws-hourly-forecast-manhattan'],
      basis: [CATALOGUE, 'apps/web/src/features/explore/map/radar-layer.ts'],
    },
  ],
};

export const events: CreditGroup = {
  id: 'events',
  credits: [
    {
      id: 'ticketmaster',
      attribution: ['Event data from the Ticketmaster Discovery API'],
      licence: {
        name: 'Ticketmaster API Terms of Use',
        url: 'https://developer.ticketmaster.com/support/terms-of-use/',
      },
      sources: numbered('ticketmaster-events-', 14),
      basis: [CATALOGUE],
    },
    {
      id: 'nycEvents',
      attribution: [
        'NYC Parks Public Events – Upcoming 14 Days (NYC Open Data)',
        'NYC Permitted Event Information (NYC Open Data, tvpp-9vvx)',
      ],
      licence: NYC_TERMS,
      sources: ['nyc-parks-events', 'nyc-permitted-events-today'],
      basis: [CATALOGUE],
    },
    {
      id: 'venues',
      attribution: [
        'Event listings published by Brooklyn Paramount on its website',
        'Event listings published by Irving Plaza on its website',
      ],
      licence: {
        name: 'Live Nation venue site terms of use',
        url: 'https://help.livenation.com/hc/en-us/articles/10468828916113-Terms-of-Use',
      },
      sources: ['brooklyn-paramount-events', 'irving-plaza-events'],
      basis: [CATALOGUE],
    },
  ],
};

export const maps: CreditGroup = {
  id: 'maps',
  credits: [
    {
      id: 'openStreetMap',
      attribution: ['© OpenStreetMap contributors'],
      licence: ODBL,
      sources: [],
      basis: ['apps/server/src/modules/data-platform/on-demand/transitous.ts'],
    },
    {
      // As the tiles' own TileJSON says it (https://tiles.openfreemap.org/planet, 11/11/2026).
      id: 'openFreeMap',
      attribution: ['OpenFreeMap © OpenMapTiles Data from OpenStreetMap'],
      licence: { name: 'OpenFreeMap, free to use', url: 'https://openfreemap.org' },
      sources: [],
      basis: ['apps/web/src/features/trip/map/style.ts'],
    },
    {
      // The shaded relief of the far zooms, a source of OpenFreeMap's styles.
      id: 'naturalEarth',
      attribution: ['Made with Natural Earth'],
      licence: {
        name: 'Natural Earth, public domain',
        url: 'https://www.naturalearthdata.com/about/terms-of-use/',
      },
      sources: [],
      basis: ['apps/web/src/features/trip/map/style.ts'],
    },
    {
      id: 'aerialBase',
      attribution: ['USGS The National Map · Imagery'],
      licence: {
        name: 'USGS The National Map, public domain',
        url: 'https://www.usgs.gov/tools/download-data-maps-national-map',
      },
      sources: [],
      basis: ['apps/web/src/features/explore/map/basemap.ts'],
    },
    {
      id: 'aerial',
      attribution: ['NYS ITS Geospatial Services'],
      licence: {
        name: 'New York State orthoimagery, offered for use in map applications',
        url: 'https://gis.ny.gov/orthoimagery',
      },
      sources: [],
      basis: ['apps/web/src/features/explore/map/basemap.ts'],
    },
    {
      id: 'geoSearch',
      attribution: ['NYC GeoSearch, NYC Planning Labs'],
      licence: { name: 'NYC GeoSearch', url: 'https://geosearch.planninglabs.nyc/' },
      sources: [],
      basis: ['apps/server/src/modules/data-platform/on-demand/geosearch.ts'],
    },
    {
      id: 'photo',
      attribution: ['“Sunrise over Manhattan” by Pierre Blaché'],
      licence: {
        name: 'CC0 1.0, public domain',
        url: 'https://commons.wikimedia.org/wiki/File:Sunrise_over_Manhattan_(49656019573).jpg',
      },
      sources: [],
      basis: ['apps/web/src/features/home/photo/README.md'],
    },
  ],
};
