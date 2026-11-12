# Data sources

Every source MovIQ collects, generated from the catalogue by `npm run docs:sources`;
`npm run verify` fails if this file is out of date. Freshness is measured on the time of the
data itself; the three limits are when a source becomes degraded, stale and unavailable.

| Source | What | Provider | Licence | Rhythm | Freshness limits | Credential |
| --- | --- | --- | --- | --- | --- | --- |
| `adsb-fi-new-york` | Aircraft around the New York airports (adsb.fi) | adsb.fi | [adsb.fi open data terms (personal, non-commercial use)](https://github.com/adsbfi/opendata) | hot: 10 min, 5 min with interest | 15 min / 30 min / 60 min | none |
| `adsb-lol-new-york` | Aircraft around the New York airports | adsb.lol | [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1.0/) | hot: 10 min, 5 min with interest | 15 min / 30 min / 60 min | none |
| `amtraker-new-york` | Amtrak trains around New York (Amtraker) | Amtraker (independent API over the Amtrak map) | [Open Data Commons Attribution License (ODC-By) 1.0](https://opendatacommons.org/licenses/by/1-0/) | hot: 2 min, 60 s with interest | 5 min / 15 min / 30 min | none |
| `bird-new-york` | Bird scooters (Queens and Bronx) | Bird Rides, Inc. (GBFS 2.3) | [Bird GBFS Data License Agreement (2018-09-25)](https://www.bird.co/wp-content/uploads/2019/03/GBFS-Data-License-Agreement-2018-09-25.pdf) | hot: 5 min, 60 s with interest | 10 min / 30 min / 2 h | none |
| `brooklyn-paramount-events` | Brooklyn Paramount events (schema.org) | Brooklyn Paramount, its own website | [Live Nation venue site terms of use](https://help.livenation.com/hc/en-us/articles/10468828916113-Terms-of-Use) | cold: 24 h | 30 h / 2 d 6 h / 4 d | none |
| `faa-airport-status` | New York airports status | Federal Aviation Administration (NAS Status) | [U.S. Government work, public domain (17 U.S.C. § 105)](https://www.faa.gov/web_policies) | warm: 5 min, 60 s with interest | 15 min / 30 min / 2 h | none |
| `irving-plaza-events` | Irving Plaza events (schema.org) | Irving Plaza, its own website | [Live Nation venue site terms of use](https://help.livenation.com/hc/en-us/articles/10468828916113-Terms-of-Use) | cold: 24 h | 30 h / 2 d 6 h / 4 d | none |
| `lime-new-york` | Lime scooters (Bronx and Queens) | Lime (GBFS 2.2) | [Lime GBFS terms](https://www.li.me/gbfs-terms) | hot: 5 min, 60 s with interest | 10 min / 30 min / 2 h | none |
| `citi-bike-station-status` | Citi Bike station status | Lyft Bikes and Scooters, LLC (Citi Bike GBFS) | [Citi Bike Data License Agreement](https://citibikenyc.com/data-sharing-policy) | hot: 2 min, 60 s with interest | 5 min / 15 min / 60 min | none |
| `citi-bike-stations` | Citi Bike stations | Lyft Bikes and Scooters, LLC (Citi Bike GBFS) | [Citi Bike Data License Agreement](https://citibikenyc.com/data-sharing-policy) | cold: 6 h | 24 h / 3 d / 7 d | none |
| `mta-alerts` | MTA service alerts (subway, buses, LIRR, Metro-North) | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | warm: 2 min, 60 s with interest | 10 min / 20 min / 60 min | none |
| `mta-bus-positions` | MTA Bus Time vehicle positions | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | hot: 60 s, 30 s with interest | 2 min / 5 min / 15 min | none |
| `mta-bus-trip-updates` | MTA Bus Time predictions | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | hot: 2 min, 30 s with interest | 3 min / 5 min / 15 min | none |
| `mta-elevator-equipment` | MTA subway elevators and escalators | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | cold: 24 h | 3 d / 14 d / 60 d | none |
| `mta-elevator-inventory` | MTA subway elevator and escalator inventory | Metropolitan Transportation Authority (MTA) | [MTA Open Data on data.ny.gov](https://www.mta.info/open-data) | cold: 24 h | 3 d / 14 d / 60 d | none |
| `mta-elevators` | MTA subway elevator and escalator outages | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | warm: 5 min, 2 min with interest | 15 min / 60 min / 3 h | none |
| `mta-gtfs-bus-bronx` | MTA Bronx bus timetable (GTFS) | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | cold: 24 h | 90 d / 120 d / 180 d | none |
| `mta-gtfs-bus-brooklyn` | MTA Brooklyn bus timetable (GTFS) | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | cold: 24 h | 90 d / 120 d / 180 d | none |
| `mta-gtfs-bus-company` | MTA Bus Company timetable (GTFS) | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | cold: 24 h | 90 d / 120 d / 180 d | none |
| `mta-gtfs-bus-manhattan` | MTA Manhattan bus timetable (GTFS) | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | cold: 24 h | 90 d / 120 d / 180 d | none |
| `mta-gtfs-bus-queens` | MTA Queens bus timetable (GTFS) | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | cold: 24 h | 90 d / 120 d / 180 d | none |
| `mta-gtfs-bus-staten-island` | MTA Staten Island bus timetable (GTFS) | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | cold: 24 h | 90 d / 120 d / 180 d | none |
| `mta-gtfs-lirr` | Long Island Rail Road timetable (GTFS) | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | cold: 24 h | 2 d / 7 d / 30 d | none |
| `mta-gtfs-metro-north` | Metro-North Railroad timetable (GTFS) | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | cold: 24 h | 2 d / 7 d / 30 d | none |
| `mta-gtfs-subway` | MTA subway timetable (GTFS) | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | cold: 24 h | 200 d / 240 d / 365 d | none |
| `mta-lirr-realtime` | Long Island Rail Road live trains | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | hot: 60 s, 30 s with interest | 2 min / 5 min / 15 min | none |
| `mta-metro-north-realtime` | Metro-North Railroad live trains | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | hot: 60 s, 30 s with interest | 2 min / 5 min / 15 min | none |
| `mta-subway-1234567` | MTA subway live: 1 2 3 4 5 6 7 and 42 St shuttle | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | hot: 60 s, 30 s with interest | 2 min / 5 min / 15 min | none |
| `mta-subway-ace` | MTA subway live: A C E and Rockaway shuttle | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | hot: 60 s, 30 s with interest | 2 min / 5 min / 15 min | none |
| `mta-subway-bdfm` | MTA subway live: B D F M and Franklin shuttle | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | hot: 60 s, 30 s with interest | 2 min / 5 min / 15 min | none |
| `mta-subway-entrances` | MTA subway entrances and exits | Metropolitan Transportation Authority (MTA) | [MTA Open Data on data.ny.gov](https://www.mta.info/open-data) | cold: 24 h | 3 d / 14 d / 60 d | none |
| `mta-subway-g` | MTA subway live: G | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | hot: 60 s, 30 s with interest | 2 min / 5 min / 15 min | none |
| `mta-subway-jz` | MTA subway live: J Z | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | hot: 60 s, 30 s with interest | 2 min / 5 min / 15 min | none |
| `mta-subway-l` | MTA subway live: L | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | hot: 60 s, 30 s with interest | 2 min / 5 min / 15 min | none |
| `mta-subway-nqrw` | MTA subway live: N Q R W | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | hot: 60 s, 30 s with interest | 2 min / 5 min / 15 min | none |
| `mta-subway-sir` | MTA subway live: Staten Island Railway | Metropolitan Transportation Authority (MTA) | [MTA Developer Terms and Conditions](https://www.mta.info/developers/terms-and-conditions) | hot: 60 s, 30 s with interest | 2 min / 5 min / 15 min | none |
| `mta-subway-stations` | MTA subway stations and their accessibility | Metropolitan Transportation Authority (MTA) | [MTA Open Data on data.ny.gov](https://www.mta.info/open-data) | cold: 24 h | 3 d / 14 d / 60 d | none |
| `moviq-recorder-stats` | MovIQ recorder statistics (Cloudflare) | MovIQ recorder on Cloudflare, from the sources it records | [Measured by MovIQ from the recorded sources, under their licences](apps/recorder-cf/README.md) | cold: 60 min | 30 h / 2 d / 8 d | moviq-recorder |
| `nws-alerts-new-york` | New York weather alerts | National Weather Service (api.weather.gov) | [U.S. Government work, public domain](https://www.weather.gov/disclaimer) | warm: 5 min, 2 min with interest | 15 min / 60 min / 3 h | none |
| `nws-hourly-forecast-manhattan` | Manhattan hourly forecast | National Weather Service (api.weather.gov) | [U.S. Government work, public domain](https://www.weather.gov/disclaimer) | warm: 15 min | 13 h / 25 h / 2 d | none |
| `staten-island-ferry-gtfs` | Staten Island Ferry timetable (GTFS) | New York City Department of Transportation (NYC DOT) | [NYC DOT data feeds disclaimer](https://www.nyc.gov/html/dot/html/about/datafeeds.shtml#disclaimer) | cold: 24 h | 400 d / 500 d / 760 d | none |
| `ny511-cameras` | 511NY traffic cameras | New York State DOT, 511NY | [511NY Developer Access Agreement](https://511ny.org/developers/daa) | cold: 6 h | 24 h / 3 d / 14 d | none |
| `ny511-closures` | 511NY road closures | New York State DOT, 511NY | [511NY Developer Access Agreement](https://511ny.org/developers/daa) | warm: 2 min, 60 s with interest | 5 min / 15 min / 60 min | none |
| `ny511-construction` | 511NY roadwork now | New York State DOT, 511NY | [511NY Developer Access Agreement](https://511ny.org/developers/daa) | warm: 5 min, 2 min with interest | 15 min / 60 min / 3 h | none |
| `ny511-crossing-times` | Port Authority crossing times (511NY) | New York State DOT, 511NY | [511NY Developer Access Agreement](https://511ny.org/developers/daa) | warm: 5 min, 2 min with interest | 20 min / 45 min / 2 h | none |
| `ny511-future-construction` | 511NY roadwork planned | New York State DOT, 511NY | [511NY Developer Access Agreement](https://511ny.org/developers/daa) | warm: 30 min | 2 h / 6 h / 24 h | none |
| `ny511-incidents` | 511NY traffic incidents | New York State DOT, 511NY | [511NY Developer Access Agreement](https://511ny.org/developers/daa) | warm: 2 min, 60 s with interest | 5 min / 15 min / 60 min | none |
| `ny511-message-signs` | 511NY message signs | New York State DOT, 511NY | [511NY Developer Access Agreement](https://511ny.org/developers/daa) | warm: 2 min, 60 s with interest | 5 min / 15 min / 60 min | none |
| `ny511-road-conditions` | 511NY winter road conditions | New York State DOT, 511NY | [511NY Developer Access Agreement](https://511ny.org/developers/daa) | warm: 15 min, 5 min with interest | 60 min / 3 h / 12 h | none |
| `ny511-special-events` | 511NY special events | New York State DOT, 511NY | [511NY Developer Access Agreement](https://511ny.org/developers/daa) | warm: 15 min, 5 min with interest | 60 min / 3 h / 12 h | none |
| `ny511-transit-events` | 511NY transit service changes | New York State DOT, 511NY | [511NY Developer Access Agreement](https://511ny.org/developers/daa) | warm: 5 min, 2 min with interest | 15 min / 60 min / 3 h | none |
| `ny511-weather-warnings` | 511NY weather warnings | New York State DOT, 511NY | [511NY Developer Access Agreement](https://511ny.org/developers/daa) | warm: 10 min, 6 min with interest | 30 min / 2 h / 6 h | none |
| `noaa-ports-battery-water-level` | NOAA PORTS water level at The Battery | NOAA Center for Operational Oceanographic Products and Services (CO-OPS), PORTS | [U.S. Government work, public domain](https://tidesandcurrents.noaa.gov/disclaimers.html) | warm: 6 min | 20 min / 60 min / 3 h | none |
| `noaa-ports-kill-van-kull-current` | NOAA PORTS current in the Kill Van Kull | NOAA Center for Operational Oceanographic Products and Services (CO-OPS), PORTS | [U.S. Government work, public domain](https://tidesandcurrents.noaa.gov/disclaimers.html) | warm: 6 min | 20 min / 60 min / 3 h | none |
| `noaa-ports-robbins-reef-wind` | NOAA PORTS wind at Robbins Reef | NOAA Center for Operational Oceanographic Products and Services (CO-OPS), PORTS | [U.S. Government work, public domain](https://tidesandcurrents.noaa.gov/disclaimers.html) | warm: 6 min | 20 min / 60 min / 3 h | none |
| `noaa-ports-verrazzano-air-gap` | NOAA PORTS air gap under the Verrazzano-Narrows Bridge | NOAA Center for Operational Oceanographic Products and Services (CO-OPS), PORTS | [U.S. Government work, public domain](https://tidesandcurrents.noaa.gov/disclaimers.html) | warm: 6 min | 20 min / 60 min / 3 h | none |
| `ny-waterway-alerts` | NY Waterway service alerts | NY Waterway, feeds hosted by Connexionz | [No published terms (public GTFS and GTFS Realtime feeds)](https://www.nywaterway.com/) | warm: 2 min | 6 min / 15 min / 60 min | none |
| `ny-waterway-gtfs` | NY Waterway timetable (GTFS) | NY Waterway, feeds hosted by Connexionz | [No published terms (public GTFS and GTFS Realtime feeds)](https://www.nywaterway.com/) | cold: 24 h | 200 d / 300 d / 400 d | none |
| `ny-waterway-positions` | NY Waterway boat positions | NY Waterway, feeds hosted by Connexionz | [No published terms (public GTFS and GTFS Realtime feeds)](https://www.nywaterway.com/) | hot: 60 s, 30 s with interest | 2 min / 5 min / 15 min | none |
| `nyc-defibrillators` | NYC automated external defibrillators | NYC Department of Health and Mental Hygiene, NYC REMSCO (NYC Open Data) | [NYC.gov terms of use (NYC Open Data)](https://www.nyc.gov/main/terms-of-use) | cold: 24 h | 3 d / 14 d / 60 d | none |
| `nyc-parks-events` | NYC Parks public events | NYC Department of Parks and Recreation (NYC Open Data) | [NYC.gov terms of use; NYC Open Data, free to use](https://www.nyc.gov/main/terms-of-use) | cold: 3 h | 28 h / 2 d 2 h / 3 d | none |
| `plownyc-status` | PlowNYC snow vehicle tracking | NYC Department of Sanitation (DSNY), PlowNYC | [PlowNYC disclaimer of the City of New York](https://plownyc.nyc.gov/plownyc/) | warm: 15 min | 35 min / 60 min / 3 h | none |
| `nyc-dot-traffic-speeds` | New York traffic speeds | NYC Department of Transportation (NYC Open Data) | [NYC.gov terms of use; freely available to the public](https://www.nyc.gov/main/terms-of-use) | warm: 5 min | 20 min / 60 min / 4 h | none |
| `nyc-parking-meters` | NYC parking meters | NYC Department of Transportation (NYC Open Data) | [NYC.gov terms of use (NYC Open Data)](https://www.nyc.gov/main/terms-of-use) | cold: 24 h | 3 d / 14 d / 60 d | none |
| `nyc-street-closures-today` | NYC street closures for construction today | NYC Department of Transportation (NYC Open Data) | [NYC.gov terms of use (NYC Open Data)](https://www.nyc.gov/main/terms-of-use) | cold: 60 min | 3 h / 12 h / 24 h | none |
| `nyc-street-permits-bronx` | NYC street construction permits in force, Bronx | NYC Department of Transportation (NYC Open Data) | [NYC.gov terms of use (NYC Open Data)](https://www.nyc.gov/main/terms-of-use) | cold: 6 h | 18 h / 3 d / 7 d | none |
| `nyc-street-permits-brooklyn` | NYC street construction permits in force, Brooklyn | NYC Department of Transportation (NYC Open Data) | [NYC.gov terms of use (NYC Open Data)](https://www.nyc.gov/main/terms-of-use) | cold: 6 h | 18 h / 3 d / 7 d | none |
| `nyc-street-permits-manhattan` | NYC street construction permits in force, Manhattan | NYC Department of Transportation (NYC Open Data) | [NYC.gov terms of use (NYC Open Data)](https://www.nyc.gov/main/terms-of-use) | cold: 6 h | 18 h / 3 d / 7 d | none |
| `nyc-street-permits-queens` | NYC street construction permits in force, Queens | NYC Department of Transportation (NYC Open Data) | [NYC.gov terms of use (NYC Open Data)](https://www.nyc.gov/main/terms-of-use) | cold: 6 h | 18 h / 3 d / 7 d | none |
| `nyc-street-permits-staten-island` | NYC street construction permits in force, Staten Island | NYC Department of Transportation (NYC Open Data) | [NYC.gov terms of use (NYC Open Data)](https://www.nyc.gov/main/terms-of-use) | cold: 6 h | 18 h / 3 d / 7 d | none |
| `nyc-ferry-alerts` | NYC Ferry service alerts | NYC Ferry (Hornblower), feeds hosted by Connexionz | [NYC Ferry Developer Terms](https://www.ferry.nyc/developer-tools/) | warm: 2 min | 6 min / 15 min / 60 min | none |
| `nyc-ferry-gtfs` | NYC Ferry timetable (GTFS) | NYC Ferry (Hornblower), feeds hosted by Connexionz | [NYC Ferry Developer Terms](https://www.ferry.nyc/developer-tools/) | cold: 24 h | 200 d / 300 d / 400 d | none |
| `nyc-ferry-positions` | NYC Ferry boat positions | NYC Ferry (Hornblower), feeds hosted by Connexionz | [NYC Ferry Developer Terms](https://www.ferry.nyc/developer-tools/) | hot: 60 s, 30 s with interest | 2 min / 5 min / 15 min | none |
| `nyc-ferry-trip-updates` | NYC Ferry predictions | NYC Ferry (Hornblower), feeds hosted by Connexionz | [NYC Ferry Developer Terms](https://www.ferry.nyc/developer-tools/) | hot: 60 s, 30 s with interest | 2 min / 5 min / 15 min | none |
| `nyc-landmarks` | NYC individual landmarks | NYC Landmarks Preservation Commission (NYC Open Data) | [NYC.gov terms of use (NYC Open Data)](https://www.nyc.gov/main/terms-of-use) | cold: 24 h | 3 d / 14 d / 60 d | none |
| `nyc-public-restrooms` | NYC public restrooms | NYC Parks, public libraries and partners (NYC Open Data) | [NYC.gov terms of use (NYC Open Data)](https://www.nyc.gov/main/terms-of-use) | cold: 24 h | 3 d / 14 d / 60 d | none |
| `nyc-permitted-events-today` | NYC permitted events today | NYC Street Activity Permit Office (NYC Open Data) | [NYC.gov terms of use (NYC Open Data)](https://www.nyc.gov/main/terms-of-use) | cold: 60 min | 3 h / 12 h / 24 h | none |
| `open-waters-new-york-harbor` | Vessels in New York Harbor (AIS) | Open Waters AIS | [Open Waters AIS, licensed per source](https://openwaters.io/ais/#license) | hot: 2 min, 60 s with interest | 5 min / 15 min / 30 min | none |
| `passio-go-route-shapes` | University and district shuttle routes (Passio GO) | Passio GO public map (Passio Technologies) | [No published terms (Passio GO public map)](https://passiogo.com/) | cold: 24 h | 2 d / 7 d / 30 d | none |
| `passio-go-shuttles` | University and district shuttles (Passio GO) | Passio GO public map (Passio Technologies) | [No published terms (Passio GO public map)](https://passiogo.com/) | hot: 60 s, 30 s with interest | 3 min / 6 min / 15 min | none |
| `path-alerts` | PATH service alerts | Port Authority of New York and New Jersey (PATH) | [panynj.gov Web Site Disclaimer](https://www.panynj.gov/port-authority/en/web-site-disclaimer.html) | warm: 2 min, 60 s with interest | 10 min / 20 min / 60 min | none |
| `path-arrivals` | PATH train arrivals | Port Authority of New York and New Jersey (RidePATH) | [panynj.gov Web Site Disclaimer](https://www.panynj.gov/port-authority/en/web-site-disclaimer.html) | hot: 60 s, 30 s with interest | 3 min / 10 min / 30 min | none |
| `ewr-shuttle-gtfs` | Newark airport shuttle timetable (GTFS) | Port Authority of New York and New Jersey, feeds hosted by Passio | [No published terms (public GTFS feed)](https://passiotech.com/) | cold: 24 h | 2 d / 7 d / 30 d | none |
| `ewr-shuttle-positions` | Newark airport shuttle positions | Port Authority of New York and New Jersey, feeds hosted by Passio | [No published terms (public GTFS Realtime feed)](https://passiotech.com/) | hot: 60 s, 30 s with interest | 2 min / 5 min / 15 min | none |
| `jfk-lga-shuttle-positions` | JFK and LaGuardia airport shuttle positions | Port Authority of New York and New Jersey, feeds hosted by Passio | [No published terms (public GTFS Realtime feed)](https://passiotech.com/) | hot: 60 s, 30 s with interest | 2 min / 5 min / 15 min | none |
| `pnct-vessel-schedule` | Port Newark Container Terminal vessel schedule | Port Newark Container Terminal (PNCT), a Ports America terminal | [PNCT Terms of Use, all rights reserved](https://www.pnct.net/content/show/TermsOfUse) | warm: 15 min | 45 min / 2 h / 6 h | none |
| `ticketmaster-events-01` | Ticketmaster events, day part 1 of 14 | Ticketmaster Discovery API | [Ticketmaster API Terms of Use](https://developer.ticketmaster.com/support/terms-of-use/) | cold: 30 min | 60 min / 3 h / 12 h | ticketmaster |
| `ticketmaster-events-02` | Ticketmaster events, day part 2 of 14 | Ticketmaster Discovery API | [Ticketmaster API Terms of Use](https://developer.ticketmaster.com/support/terms-of-use/) | cold: 30 min | 60 min / 3 h / 12 h | ticketmaster |
| `ticketmaster-events-03` | Ticketmaster events, day part 3 of 14 | Ticketmaster Discovery API | [Ticketmaster API Terms of Use](https://developer.ticketmaster.com/support/terms-of-use/) | cold: 2 h | 4 h / 12 h / 24 h | ticketmaster |
| `ticketmaster-events-04` | Ticketmaster events, day part 4 of 14 | Ticketmaster Discovery API | [Ticketmaster API Terms of Use](https://developer.ticketmaster.com/support/terms-of-use/) | cold: 2 h | 4 h / 12 h / 24 h | ticketmaster |
| `ticketmaster-events-05` | Ticketmaster events, day part 5 of 14 | Ticketmaster Discovery API | [Ticketmaster API Terms of Use](https://developer.ticketmaster.com/support/terms-of-use/) | cold: 2 h | 4 h / 12 h / 24 h | ticketmaster |
| `ticketmaster-events-06` | Ticketmaster events, day part 6 of 14 | Ticketmaster Discovery API | [Ticketmaster API Terms of Use](https://developer.ticketmaster.com/support/terms-of-use/) | cold: 2 h | 4 h / 12 h / 24 h | ticketmaster |
| `ticketmaster-events-07` | Ticketmaster events, day part 7 of 14 | Ticketmaster Discovery API | [Ticketmaster API Terms of Use](https://developer.ticketmaster.com/support/terms-of-use/) | cold: 6 h | 12 h / 36 h / 3 d | ticketmaster |
| `ticketmaster-events-08` | Ticketmaster events, day part 8 of 14 | Ticketmaster Discovery API | [Ticketmaster API Terms of Use](https://developer.ticketmaster.com/support/terms-of-use/) | cold: 6 h | 12 h / 36 h / 3 d | ticketmaster |
| `ticketmaster-events-09` | Ticketmaster events, day part 9 of 14 | Ticketmaster Discovery API | [Ticketmaster API Terms of Use](https://developer.ticketmaster.com/support/terms-of-use/) | cold: 6 h | 12 h / 36 h / 3 d | ticketmaster |
| `ticketmaster-events-10` | Ticketmaster events, day part 10 of 14 | Ticketmaster Discovery API | [Ticketmaster API Terms of Use](https://developer.ticketmaster.com/support/terms-of-use/) | cold: 6 h | 12 h / 36 h / 3 d | ticketmaster |
| `ticketmaster-events-11` | Ticketmaster events, day part 11 of 14 | Ticketmaster Discovery API | [Ticketmaster API Terms of Use](https://developer.ticketmaster.com/support/terms-of-use/) | cold: 6 h | 12 h / 36 h / 3 d | ticketmaster |
| `ticketmaster-events-12` | Ticketmaster events, day part 12 of 14 | Ticketmaster Discovery API | [Ticketmaster API Terms of Use](https://developer.ticketmaster.com/support/terms-of-use/) | cold: 6 h | 12 h / 36 h / 3 d | ticketmaster |
| `ticketmaster-events-13` | Ticketmaster events, day part 13 of 14 | Ticketmaster Discovery API | [Ticketmaster API Terms of Use](https://developer.ticketmaster.com/support/terms-of-use/) | cold: 6 h | 12 h / 36 h / 3 d | ticketmaster |
| `ticketmaster-events-14` | Ticketmaster events, day part 14 of 14 | Ticketmaster Discovery API | [Ticketmaster API Terms of Use](https://developer.ticketmaster.com/support/terms-of-use/) | cold: 6 h | 12 h / 36 h / 3 d | ticketmaster |
| `uscg-sector-new-york-notices` | Coast Guard Sector New York broadcast notices to mariners | U.S. Coast Guard, Sector New York (GovDelivery RSS) | [U.S. Government work, public domain](https://www.usa.gov/government-copyright) | warm: 15 min | 45 min / 2 h / 6 h | none |
| `nyc-ev-chargers` | EV charging stations in New York City | U.S. Department of Energy (AFDC), via NYSERDA on data.ny.gov | [Open NY Terms of Use](https://data.ny.gov/dataset/OPEN-NY-Terms-Of-Use/77gx-ii52) | cold: 24 h | 3 d / 14 d / 60 d | none |
| `afdc-ev-chargers-new-jersey` | EV charging stations on the New Jersey side (AFDC) | U.S. Department of Energy, Alternative Fuels Data Center (NLR developer API) | [NLR Developer Network terms and conditions](https://developer.nlr.gov/terms/) | cold: 24 h | 3 d / 14 d / 60 d | nlr |
| `veo-bronx` | Veo e-bikes and scooters (Bronx) | Veo (GBFS 2.2) | [No published terms (public GBFS feed)](https://www.veoride.com) | hot: 5 min, 60 s with interest | 10 min / 30 min / 2 h | none |
| `veo-queens` | Veo e-bikes and scooters (Queens) | Veo (GBFS 2.2) | [No published terms (public GBFS feed)](https://www.veoride.com) | hot: 5 min, 60 s with interest | 10 min / 30 min / 2 h | none |
| `adsb-routes` | Usual routes of flights through New York | Virtual Radar Server standing data, served by adsb.lol | [CC0 1.0 Universal](https://github.com/vradarserver/standing-data) | cold: 24 h | 2 d / 7 d / 30 d | none |
| `bee-line-gtfs` | Bee-Line timetable (GTFS) | Westchester County Bee-Line System, feeds hosted by GMV | [Westchester County Transit API Service Terms of Service](https://planning.westchestercountyny.gov/transportation-planning/gfts-developers-transit-api/transit-api-service-terms-of-service) | cold: 24 h | 2 d / 4 d / 8 d | none |
| `bee-line-positions` | Bee-Line bus positions (Westchester) | Westchester County Bee-Line System, feeds hosted by GMV | [Westchester County Transit API Service Terms of Service](https://planning.westchestercountyny.gov/transportation-planning/gfts-developers-transit-api/transit-api-service-terms-of-service) | hot: 60 s, 30 s with interest | 2 min / 5 min / 15 min | none |

## Credits

- Aircraft positions from adsb.fi (https://adsb.fi)
- Aircraft positions from adsb.lol, available under the ODbL 1.0
- Train data from Amtraker (https://amtraker.com)
- Vehicle data from Bird
- Event listings published by Brooklyn Paramount on its website
- Federal Aviation Administration, NAS Status
- Event listings published by Irving Plaza on its website
- Vehicle data from Lime
- Bike share data provided by Lyft Bikes and Scooters, LLC
- Data from the Metropolitan Transportation Authority (MTA)
- MTA Elevator and Escalator Inventory, Metropolitan Transportation Authority (data.ny.gov)
- MTA Subway Entrances and Exits: 2024, Metropolitan Transportation Authority
- MTA Subway Stations, Metropolitan Transportation Authority (data.ny.gov)
- Reliability measured by MovIQ from MTA and city open data
- National Weather Service (NOAA)
- Information originally compiled by the New York City Department of Transportation (NYC DOT)
- Powered by 511NY
- NOAA Tides and Currents, New York and New Jersey Harbor PORTS
- Schedules and real-time data from NY Waterway
- New York City AED Inventory, NYC Department of Health and Mental Hygiene (NYC Open Data, 2er2-jqsx)
- NYC Parks Public Events – Upcoming 14 Days (NYC Open Data)
- Snow clearing data from the NYC Department of Sanitation (PlowNYC)
- NYC Department of Transportation, Traffic Speeds (NYC Open Data)
- Parking Meters Locations and Status, NYC DOT (NYC Open Data, 693u-uax6)
- Street Closures due to construction activities by Block, NYC DOT (NYC Open Data, i6b5-j7bu)
- Street Construction Permits, NYC DOT (NYC Open Data, tqtj-sjs8)
- Schedules and real-time data from NYC Ferry
- NYC Landmarks Preservation Commission, Individual Landmark Sites (buis-pvji)
- Public Restrooms, City of New York (NYC Open Data, i7jb-7jku)
- NYC Permitted Event Information (NYC Open Data, tvpp-9vvx)
- Open Waters AIS (https://openwaters.io/ais/), with AISHub contributors (https://www.aishub.net) and aisstream.io
- Shuttle route shapes from Passio GO
- Shuttle positions from Passio GO
- Service alerts from the Port Authority of New York and New Jersey (PATH)
- Real-time arrivals from the Port Authority of New York and New Jersey (RidePATH)
- Airport shuttle data from the Port Authority of New York and New Jersey (Passio)
- Vessel schedule from Port Newark Container Terminal (PNCT)
- Event data from the Ticketmaster Discovery API
- Broadcast Notices to Mariners from the U.S. Coast Guard, Sector New York
- Electric Vehicle Charging Stations in New York, U.S. Department of Energy (data.ny.gov)
- Alternative Fuels Data Center, U.S. Department of Energy
- Vehicle data from Veo
- Usual routes from the Virtual Radar Server standing data (CC0)
- Bus data from the Westchester County Bee-Line System
