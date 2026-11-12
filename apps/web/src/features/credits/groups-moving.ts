import {
  BOROUGHS,
  CATALOGUE,
  MTA_TERMS,
  NO_TERMS_GTFS,
  ODBL,
  PUBLIC_DOMAIN,
  SUBWAY_LINES,
  type CreditGroup,
} from './credit';

// The credits of what moves: transit, shared bikes and scooters, flights and the harbor.

export const transit: CreditGroup = {
  id: 'transit',
  credits: [
    {
      id: 'mta',
      attribution: ['Data from the Metropolitan Transportation Authority (MTA)'],
      licence: MTA_TERMS,
      sources: [
        'mta-alerts',
        'mta-bus-positions',
        'mta-bus-trip-updates',
        'mta-elevator-equipment',
        'mta-elevators',
        ...BOROUGHS.map((borough) => `mta-gtfs-bus-${borough}`),
        'mta-gtfs-bus-company',
        'mta-gtfs-lirr',
        'mta-gtfs-metro-north',
        'mta-gtfs-subway',
        'mta-lirr-realtime',
        'mta-metro-north-realtime',
        ...SUBWAY_LINES.map((line) => `mta-subway-${line}`),
      ],
      basis: [CATALOGUE],
    },
    {
      id: 'mtaOpenData',
      attribution: [
        'MTA Elevator and Escalator Inventory, Metropolitan Transportation Authority (data.ny.gov)',
        'MTA Subway Entrances and Exits: 2024, Metropolitan Transportation Authority',
        'MTA Subway Stations, Metropolitan Transportation Authority (data.ny.gov)',
      ],
      licence: { name: 'MTA Open Data on data.ny.gov', url: 'https://www.mta.info/open-data' },
      sources: ['mta-elevator-inventory', 'mta-subway-entrances', 'mta-subway-stations'],
      basis: [CATALOGUE],
    },
    {
      id: 'transitous',
      attribution: ['Routing by Transitous, map data © OpenStreetMap contributors'],
      licence: { name: 'Transitous and its sources', url: 'https://transitous.org/sources/' },
      sources: [],
      basis: ['apps/server/src/modules/data-platform/on-demand/transitous.ts'],
    },
    {
      id: 'path',
      attribution: [
        'Service alerts from the Port Authority of New York and New Jersey (PATH)',
        'Real-time arrivals from the Port Authority of New York and New Jersey (RidePATH)',
      ],
      licence: {
        name: 'panynj.gov Web Site Disclaimer',
        url: 'https://www.panynj.gov/port-authority/en/web-site-disclaimer.html',
      },
      sources: ['path-alerts', 'path-arrivals'],
      basis: [CATALOGUE],
    },
    {
      id: 'amtraker',
      attribution: ['Train data from Amtraker (https://amtraker.com)'],
      licence: {
        name: 'Open Data Commons Attribution License (ODC-By) 1.0',
        url: 'https://opendatacommons.org/licenses/by/1-0/',
      },
      sources: ['amtraker-new-york'],
      basis: [CATALOGUE],
    },
    {
      id: 'beeLine',
      attribution: ['Bus data from the Westchester County Bee-Line System'],
      licence: {
        name: 'Westchester County Transit API Service Terms of Service',
        url:
          'https://planning.westchestercountyny.gov/transportation-planning/' +
          'gfts-developers-transit-api/transit-api-service-terms-of-service',
      },
      sources: ['bee-line-gtfs', 'bee-line-positions'],
      basis: [CATALOGUE],
    },
    {
      id: 'nycFerry',
      attribution: ['Schedules and real-time data from NYC Ferry'],
      licence: { name: 'NYC Ferry Developer Terms', url: 'https://www.ferry.nyc/developer-tools/' },
      sources: [
        'nyc-ferry-alerts',
        'nyc-ferry-gtfs',
        'nyc-ferry-positions',
        'nyc-ferry-trip-updates',
      ],
      basis: [CATALOGUE],
    },
    {
      id: 'nyWaterway',
      attribution: ['Schedules and real-time data from NY Waterway'],
      licence: NO_TERMS_GTFS,
      sources: ['ny-waterway-alerts', 'ny-waterway-gtfs', 'ny-waterway-positions'],
      basis: [CATALOGUE],
    },
    {
      id: 'statenIslandFerry',
      attribution: [
        'Information originally compiled by the New York City Department of Transportation (NYC DOT)',
      ],
      licence: {
        name: 'NYC DOT data feeds disclaimer',
        url: 'https://www.nyc.gov/html/dot/html/about/datafeeds.shtml#disclaimer',
      },
      sources: ['staten-island-ferry-gtfs'],
      basis: [CATALOGUE],
    },
    {
      id: 'airportShuttles',
      attribution: [
        'Airport shuttle data from the Port Authority of New York and New Jersey (Passio)',
      ],
      licence: {
        name: 'No published terms (public GTFS Realtime feed)',
        url: 'https://passiotech.com/',
      },
      sources: ['ewr-shuttle-positions', 'jfk-lga-shuttle-positions', 'ewr-shuttle-gtfs'],
      basis: [CATALOGUE],
    },
    {
      id: 'passioGo',
      attribution: ['Shuttle positions from Passio GO', 'Shuttle route shapes from Passio GO'],
      licence: { name: 'No published terms (Passio GO public map)', url: 'https://passiogo.com/' },
      sources: ['passio-go-shuttles', 'passio-go-route-shapes'],
      basis: [CATALOGUE],
    },
  ],
};

export const bikes: CreditGroup = {
  id: 'bikes',
  credits: [
    {
      // The licence lets the data into a product but not the operator's marks, so none is shown.
      id: 'bikeShare',
      attribution: ['Bike share data provided by Lyft Bikes and Scooters, LLC'],
      licence: {
        name: 'Data License Agreement of Lyft Bikes and Scooters, LLC',
        url: 'https://citibikenyc.com/data-sharing-policy',
      },
      sources: ['citi-bike-station-status', 'citi-bike-stations'],
      basis: ['apps/server/src/modules/live/feeds/bikes.ts'],
    },
    {
      id: 'bird',
      attribution: ['Vehicle data from Bird'],
      licence: {
        name: 'Bird GBFS Data License Agreement (2018-09-25)',
        url: 'https://www.bird.co/wp-content/uploads/2019/03/GBFS-Data-License-Agreement-2018-09-25.pdf',
      },
      sources: ['bird-new-york'],
      basis: [CATALOGUE],
    },
    {
      id: 'lime',
      attribution: ['Vehicle data from Lime'],
      licence: { name: 'Lime GBFS terms', url: 'https://www.li.me/gbfs-terms' },
      sources: ['lime-new-york'],
      basis: [CATALOGUE],
    },
    {
      id: 'veo',
      attribution: ['Vehicle data from Veo'],
      licence: { name: 'No published terms (public GBFS feed)', url: 'https://www.veoride.com' },
      sources: ['veo-bronx', 'veo-queens'],
      basis: [CATALOGUE],
    },
  ],
};

export const air: CreditGroup = {
  id: 'air',
  credits: [
    {
      id: 'aeroDataBox',
      attribution: ['Flight data by AeroDataBox'],
      licence: {
        name: 'AeroDataBox free plan: non-commercial use, with attribution',
        url: 'https://aerodatabox.com/pricing',
      },
      sources: [],
      basis: ['apps/server/src/modules/airports/board.ts'],
    },
    {
      id: 'faa',
      attribution: ['Federal Aviation Administration, NAS Status'],
      licence: {
        name: `${PUBLIC_DOMAIN} (17 U.S.C. § 105)`,
        url: 'https://www.faa.gov/web_policies',
      },
      sources: ['faa-airport-status'],
      basis: [CATALOGUE],
    },
    {
      id: 'adsbLol',
      attribution: ['Aircraft positions from adsb.lol, available under the ODbL 1.0'],
      licence: ODBL,
      sources: ['adsb-lol-new-york'],
      basis: [CATALOGUE],
    },
    {
      id: 'adsbFi',
      attribution: ['Aircraft positions from adsb.fi (https://adsb.fi)'],
      licence: {
        name: 'adsb.fi open data terms (personal, non-commercial use)',
        url: 'https://github.com/adsbfi/opendata',
      },
      sources: ['adsb-fi-new-york'],
      basis: [CATALOGUE],
    },
    {
      id: 'virtualRadar',
      attribution: ['Usual routes from the Virtual Radar Server standing data (CC0)'],
      licence: {
        name: 'CC0 1.0 Universal',
        url: 'https://github.com/vradarserver/standing-data',
      },
      sources: ['adsb-routes'],
      basis: [CATALOGUE],
    },
  ],
};

export const harbor: CreditGroup = {
  id: 'harbor',
  credits: [
    {
      id: 'openWaters',
      attribution: [
        'Open Waters AIS (https://openwaters.io/ais/), with AISHub contributors ' +
          '(https://www.aishub.net) and aisstream.io',
      ],
      licence: {
        name: 'Open Waters AIS, licensed per source',
        url: 'https://openwaters.io/ais/#license',
      },
      sources: ['open-waters-new-york-harbor'],
      basis: [CATALOGUE],
    },
    {
      id: 'noaaPorts',
      attribution: ['NOAA Tides and Currents, New York and New Jersey Harbor PORTS'],
      licence: { name: PUBLIC_DOMAIN, url: 'https://tidesandcurrents.noaa.gov/disclaimers.html' },
      sources: [
        'noaa-ports-battery-water-level',
        'noaa-ports-kill-van-kull-current',
        'noaa-ports-robbins-reef-wind',
        'noaa-ports-verrazzano-air-gap',
      ],
      basis: [CATALOGUE],
    },
    {
      id: 'coastGuard',
      attribution: ['Broadcast Notices to Mariners from the U.S. Coast Guard, Sector New York'],
      licence: { name: PUBLIC_DOMAIN, url: 'https://www.usa.gov/government-copyright' },
      sources: ['uscg-sector-new-york-notices'],
      basis: [CATALOGUE],
    },
    {
      id: 'pnct',
      attribution: ['Vessel schedule from Port Newark Container Terminal (PNCT)'],
      licence: {
        name: 'PNCT Terms of Use, all rights reserved',
        url: 'https://www.pnct.net/content/show/TermsOfUse',
      },
      sources: ['pnct-vessel-schedule'],
      basis: [CATALOGUE],
    },
  ],
};
