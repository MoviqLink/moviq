# Extractors

One extractor per source turns each admitted version into compact events, keeping only what
changed since the version before. `index.ts` is the registry: a new source joins with one file
here and one line there; a source without one is collected but not recorded, and the status of
the recorder says so.

| File            | Sources                                                                                              | Events                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `subway.ts`     | The 8 subway feeds                                                                                   | `train`, arrivals and departures, `pred`; cancelled trips left out   |
| `bus.ts`        | Bus Time positions and trips                                                                         | `assign`, `gps`, `held`, passages, `pred`; cancelled trips left out  |
| `trip-stops.ts` | Shared by subway and buses                                                                           | Departures from dropped stops, sampled `pred`                        |
| `lifecycle.ts`  | Shared by every incident source                                                                      | `open`, `change`, `close`                                            |
| `incidents.ts`  | Alerts, elevators, FAA, NWS                                                                          | Incidents while they are under way                                   |
| `samples.ts`    | NYC DOT speeds, NWS forecast                                                                         | `sample` when a value changes                                        |
| `positions.ts`  | LIRR, Metro-North, Amtrak, NYC Ferry, NY Waterway, Bee-Line, shuttles, aircraft (ADS-B), ships (AIS) | `assign` and `gps` when a vehicle moves 15 m or changes stop or trip |
| `counts.ts`     | Citi Bike stations, shared scooters and e-bikes                                                      | `sample` of station counts, and of vehicles by cell of 0.01°         |

Positions and counts have no mode: the nightly process times subway and bus trips only. Shared
vehicles are counted by cell because most systems rotate their ids on every answer.

Tested in `apps/server/tests/recorder/extractors.test.ts` and `positions.test.ts`.
