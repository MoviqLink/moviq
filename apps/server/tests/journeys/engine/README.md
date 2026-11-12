# Routing engine tests

| File                      | Covers                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `routing.test.ts`         | Latest trips first, change times, walking transfers, Pareto front, past midnight, walks and ties               |
| `live.test.ts`            | Cancelled, late and early trips, passed stops, stale feeds, step-free, no way, missing timetables, determinism |
| `raptor.test.ts`          | RAPTOR rounds directly: one departure per number of rides, no trip borrowed across patterns                    |
| `rules.test.ts`           | Pickup and drop-off, `transfers.txt` times and type 3, stations, step-free changes                             |
| `step-free-plans.test.ts` | Step-free plans: modes without step-free stops, walks through an elevator entrance                             |
| `capture.test.ts`         | The real subway capture: a ride along its shape, a change and a live trip id, checked against the GTFS files   |
| `ride-shapes.test.ts`     | A ride's way along its shape: cut at the stops, loops met in order, no shape or a stop off it                  |
| `step-free.test.ts`       | Step-free stops: one direction, outages now and announced, removed elevators, stand-ins, notes                 |
| `platform.test.ts`        | The composition over a platform reader: step-free plans without the fallback, the fallback                     |
| `street-walks.test.ts`    | Walks on the streets: a change too long left out, searched again, departure moved, wheelchair, Transitous down |
| `street-no-way.test.ts`   | Walks with no way on the streets: left out, searched again without them, the refusal says where; not asked     |
| `street-support.ts`       | The engine over the walk captures, the networks and places the street tests share                              |
| `hand-network.ts`         | The hand-written network, its places and query helpers                                                         |
| `gtfs-capture.ts`         | A real GTFS archive read into what the engine takes, through the platform's index and its stop times           |
| `columns.ts`              | Trips laid out as the stop time columns the engine reads                                                       |
| `shape-checks.ts`         | Distances from a path to the vertices of a shape                                                               |

Times in the hand-written network are New York wall-clock times on Tuesday 10 November 2026.
