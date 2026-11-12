# Sources

One folder per provider family, each exporting its definitions from `index.ts`.

| Folder           | Sources                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `mta/`           | MTA timetables (GTFS), subway and buses in real time, service alerts, elevators                                                                 |
| `accessibility/` | MTA subway stations with step-free access by direction, and every elevator and escalator                                                        |
| `city/`          | FAA airport status, NYC DOT traffic speeds, National Weather Service                                                                            |
| `ny511/`         | 511NY layers read as its own map reads them: closures, incidents, construction, events, road conditions, message signs, cameras, crossing times |
| `street/`        | NYC street closures and permitted events today, street permits, parking meters and signs, EV chargers, defibrillators, public restrooms         |
| `events/`        | Ticketmaster Discovery (14 windows), NYC Parks events, Irving Plaza and Brooklyn Paramount (schema.org)                                         |
| `recorder/`      | MovIQ's own statistics, published nightly by the 24-hour recorder on Cloudflare (`apps/recorder-cf`)                                            |
| `regional/`      | LIRR and Metro-North in real time (GPS) and their timetables; PATH arrivals                                                                     |
| `ferries/`       | NYC Ferry positions (GPS) and predictions; NYC Ferry and Staten Island Ferry timetables                                                         |
| `harbor/`        | The port: Coast Guard notices, PNCT vessel calls and NOAA PORTS (water level, air gap, current, wind)                                           |
| `bikes/`         | Citi Bike stations and their bikes and docks free (GBFS)                                                                                        |
| `air/`           | Aircraft around JFK, LGA and EWR (ADS-B: adsb.lol, adsb.fi as backup) and their usual routes                                                    |
| `sea/`           | Ships in New York Harbor (AIS, Open Waters)                                                                                                     |
| `amtrak/`        | Amtrak trains around New York (GPS), from Amtraker                                                                                              |
| `westchester/`   | Westchester Bee-Line buses (GPS) and their timetable                                                                                            |
| `shuttles/`      | Airport shuttles of JFK, LGA and EWR, and university shuttles (GPS, Passio)                                                                     |
| `micromobility/` | Shared e-scooters and e-bikes parked around the city (GBFS: Lime, Veo, Bird)                                                                    |
| `city-ops/`      | City operations: PlowNYC snow-plow tracking                                                                                                     |

Each source is tested against small captures of real responses in `tests/fixtures/` at the
repository root.
