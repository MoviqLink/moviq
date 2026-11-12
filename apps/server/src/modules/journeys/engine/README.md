# Routing engine

MovIQ's own `RoutingProvider` (`sourceId: 'moviq-raptor'`): itineraries that arrive by a given
time over the MTA timetables served by the data platform, with live predictions in place of the
timetable where the feeds have them. The same query on the same snapshots always gives the same
answer, in the same order. Transitous stays as a second opinion and fallback.

| File                                    | Responsibility                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `inputs.ts`                             | The port: timetables (GTFS index plus stop times, transfers, step-free) and live trips  |
| `provider.ts`                           | `createEngineRouting`: reads the port, compiles once per version set, plans, explains   |
| `moviq-routing.ts`                      | `createMovIqRouting`: the engine, then the fallback when it says no, never step-free    |
| `platform-sources.ts`                   | The port over the data platform: 7 timetables, step-free data, subway and Bus Time      |
| `timetable-input.ts`                    | A served GTFS index as engine input; stop times checked once, decoded when compiling    |
| `step-free.ts`                          | Step-free stops for one trip: station list and notes, entrances, findings by station    |
| `elevator-paths.ts`                     | Step-free elevators whose path is broken during a trip: outages, inventory, stand-ins   |
| `step-free-changes.ts`                  | Step-free refusals by mode, changes between stops, the step-free part of the evidence   |
| `entrances.ts`                          | Step-free entrances by stop, and walks measured through them                            |
| `network.ts`, `trip-drafts.ts`          | Compiles timetables into flat typed arrays; trips that cannot be ridden are counted out |
| `patterns.ts`                           | Trips grouped into FIFO patterns by route, service and stop sequence                    |
| `footpaths.ts`, `grid.ts`, `walking.ts` | Transfers: `transfers.txt` rules and nearby stops on foot, the step-free ones; walking  |
| `service-days.ts`                       | The two service days a deadline can use, in New York time                               |
| `live.ts`, `live-sources.ts`            | Live trips matched to timetable trips; adapters from the subway and Bus Time feeds      |
| `labels.ts`, `scan.ts`, `raptor.ts`     | Backward RAPTOR: labels, route scans and rounds                                         |
| `ride-shapes.ts`                        | Each trip's shape from the GTFS index, cut from the stop boarded to the stop left       |
| `reconstruct.ts`, `search.ts`           | Itineraries from the labels; several departures, direct walk, stable order              |
| `walk-legs.ts`                          | Walk legs and their labels, the walks to check and the street times already known       |
| `street-walks.ts`                       | The port to the streets the final walks are walked on (Transitous on the platform)      |
| `street-check.ts`, `street-retime.ts`   | The final walks on the streets: retimed, left out when broken, searched again once      |

## Algorithm

RAPTOR run backwards (D. Delling, T. Pajor, R. F. Werneck, "Round-Based Public Transit Routing",
_Transportation Science_ 49(3):591-604, 2015; section 3, and its reverse search for "arrive by").
Round `k` gives every stop the latest time to board there and still reach the destination by the
deadline with `k` rides. A label is kept only if it beats every earlier round, the best origin
departure so far and the current time, so the origin departures of successive rounds are the
Pareto front of departure time and number of rides. At most 4 rides (3 transfers) by default.

- **Several options:** each pass returns its front; the next pass moves the deadline to one second
  before the earliest arrival found, until `count` itineraries or no more journeys.
- **Patterns:** trips with the same route, service and stops in the same order, split first-fit so
  that no trip overtakes another; the latest trip at one stop is then the latest at all of them.
- **Service days:** the New York date of the deadline and the one before, each starting at noon
  minus 12 hours as GTFS defines it, so trips past 24:00 and daylight-saving days are exact.
- **Robust changes:** where the same trip can be left at several stops, the one leaving the most
  time before the next ride is kept (on the subway capture, the 1 to the 2 at Times Sq).
- **Order:** latest departure first, then fewer rides, earlier arrival, and a signature of every
  leg. Every array is built in sorted order and every comparison is strict, so ties always fall
  the same way.

## Assumptions

- **Walking:** the search estimates every walk from the straight line × 1.3 at 1.2 m/s, with the
  sources in `walking.ts`. Access and egress walks reach as far as `maxWalkMinutes`; a place
  with a `stopId` boards there (a station boards at its platforms) without walking. A trip on
  foot only is offered when `walk` is among the modes and fits the limit.
- **Walks on the streets:** before a plan is returned, each walk of its itineraries (to the first
  ride, from the last, the trip on foot only, and every change between two stops that no
  `transfers.txt` rule times) is asked of the streets (`StreetWalks`; Transitous, MOTIS 2 over
  OpenStreetMap), with the wheelchair profile on a step-free trip, from and to the step-free
  entrance where the walk goes through one. Its seconds, metres and path replace the estimate: a
  walk to the first ride moves the departure, a change or a walk to the destination moves what
  follows. An itinerary the street times break (a change that misses the next ride, a start before
  now, an arrival past the deadline, a walk over the limit) is left out, and so is one with a walk
  the streets answer has no way (`no-street-route`: none within the hour Transitous is asked for);
  then the engine searches once more with the street times known, without the stops and changes
  that have no way, and the new walks are asked too. At most 8 requests per plan; what is not
  answered (Transitous down) or not asked (the share spent) stays estimated, so its itinerary is
  provisional, and its leg says why (`walk.unchecked`). Each walk leg says how it is known
  (`walk.basis`: `street`, `station-rule`, `estimated`), and the evidence counts them and names
  the walks with no way. When no itinerary is left and some had a walk with no way, the answer
  is `no-street-way`, saying where: from the start, a change, to the destination, door to door.
- **Transfers:** a stop always reaches itself, in 60 s unless `transfers.txt` sets a time; nearby
  stops within 400 m are joined at the walking time; `transfers.txt` rules, written by the MTA
  between stations, apply to their platforms and override the walk (type 3 removes the transfer).
  Footpaths are one hop per round. A step-free trip has its own table: no change is walked from
  coordinates (the platforms of a station share one point, and at 1 Av changing sides of the L
  means leaving and crossing 14 St), only the same stop and the `transfers.txt` rules between
  accessible stops of one complex (the station list's `complex_id`; the rules from Junius St to
  Livonia Av and from 59 St to Lexington Av/63 St join two complexes and are not followed). The
  MTA files have no `pathways.txt` or `levels.txt`, so none of those changes is verified
  step-free inside the station: the evidence names them (`stopChanges`).
- **Places and paths:** stops sit at their GTFS coordinates; there are no walks inside stations.
  A step-free walk to the first ride starts at the nearest elevator or ramp of the station that
  lets people in, and one from the last ends at the nearest that lets them out, from the MTA
  entrance survey of 2024; where it lists none for the station (86 of the 174 accessible on
  11/11/2026, 96 St and 59 St-Columbus Circle among them, whose elevators it types otherwise),
  the walk goes to the station's point and the evidence says so.
- **Paths:** a ride follows its trip's shape (`shapes.txt`, kept in the GTFS index as encoded
  polylines) from the stop it boards at to the one it leaves at. The trip's stops are met on the
  shape in order from its first, each at the first pass within 50 m after the previous one, so a
  loop is cut where the trip calls (on the captures of 11/11/2026 every subway stop is within 1 m of
  its shape and every Queens bus stop within 12 m). A trip without a shape, from an index stored
  before shapes were read, or with a stop off it, is drawn through its stops. A walk has the path
  the streets gave it; an estimated walk or a station's change has none.
- **Modes:** GTFS `route_type` 1 (and 4xx) subway, 3 (and 7xx) bus, 2 (1xx) rail, 4 (10xx) ferry.
- **Step-free:** only stops whose GTFS `wheelchair_boarding` is 1, directly or through their
  station. A stop without the field is not accessible. The MTA files carry no such column, so on
  the platform it comes from the MTA station list (both platforms of a fully accessible station,
  one platform of a station accessible one way) for one trip, from now to its arrival
  (`step-free.ts`). A station is then `closed` while an ADA elevator of its path is out: an
  outage in force, or one announced that starts by the arrival and is not over, by its estimated
  return, before the trip can leave. It is `unknown` while one is removed or out of service in
  the inventory (`94fv-bak7`) or marked inactive in the equipment list, or when its note in the
  station list is not one of the one-direction notes already in its N and S flags ("Uptown local
  only" at 86 St). A redundant elevator keeps its station open only while, at every level the
  inventory lists, one of its stand-ins works and is followed by the outages feed; with none
  listed the pair is not known. Closed and unknown stations are not step-free. All five sources
  (station list, equipment list, inventory, outages and entrance survey) must be `healthy` or
  `degraded`, and every elevator out must be placed on a listed station; otherwise a step-free
  query is refused with `no-step-free-data`, and so is one whose modes have no stop marked: the
  buses, whose files say nothing. Asked with subway and buses, a step-free plan rides the subway
  only and the evidence says the buses were left out.

## Live data

A live trip is matched to exactly one timetable trip and service day, or not at all: Bus Time uses
the static trip id; the subway feeds use its part after the first underscore, sometimes without
the path (`115550_1..N`). A matched trip leaves the timetable scan and is scanned on its own with
its predicted times, marked `scheduled: false`. Stops before the first predicted one have been
passed and stops the prediction leaves out are not confirmed: neither is used to board or alight.
A trip the feed cancels (`schedule_relationship` CANCELED or DELETED) is left out. Feeds whose
state is not `healthy` or `degraded` are not used, and the evidence names them.

## On the platform

`createMovIqRouting({ reader, clock, fallback })` reads, through the platform reader, the seven
MTA timetables with their stop times, the subway's step-free data for the trip's window and the
eight subway feeds and Bus Time predictions. Each timetable is checked once per version (its stop times decode whole)
and its columns are decoded only when the engine compiles, so they do not stay in memory beside
the network (Brooklyn: 0.05 s and 30 MB). The subway's version also names the step-free data, so
the network is compiled again when a list, or the stations closed or unknown for the window,
change. When the engine answers `!ok` the fallback (Transitous) is asked, and its provenance says
why the engine did not answer; when both fail, the engine's refusal is given with the fallback's
reason. A plan its caller cancelled is not asked again, nor a step-free one: Transitous knows
neither the station list nor the outages (from 96 St to Van Cortlandt Park-242 St it gave the 1
to a station without step-free access), so the engine's refusal stands.

## Answers

`ProviderOutcome` with the itineraries and a provenance: the oldest data time of the inputs used,
the worst of their states (`degraded` when a timetable is missing), and an evidence sentence that
names every timetable with its version and the live feeds used or not. Without any timetable the
answer is `unavailable` (`no-timetable`); with no journey in time, `no-itineraries`, or
`no-street-way` when the streets have no way for the walks of the journeys found.

## Memory and time

Measured on 11/11/2026 with Node 24 on the development Mac, from the full MTA files of that day
(subway `20261028`, buses `20261009`), `--expose-gc` heap differences:

| Network                    | Stops | Trips  | Stop times | Footpaths | Compile | Typed arrays | Other heap | Plan, 5 options |
| -------------------------- | ----- | ------ | ---------- | --------- | ------- | ------------ | ---------- | --------------- |
| Subway                     | 989   | 20,310 | 562,943    | 3,727     | 0.12 s  | 5.4 MB       | 5.4 MB     | 2-7 ms          |
| Subway and Manhattan buses | 2,812 | 58,182 | 1,737,583  | 49,172    | 0.30 s  | 16.5 MB      | 11.4 MB    | 3-19 ms         |

All seven files hold 8.0 M stop times (Brooklyn 2.40 M, Bronx 1.16 M, Manhattan 1.17 M, Queens
0.82 M, Staten Island 0.81 M, MTA Bus Company 1.08 M, subway 0.56 M), 4.6 times the second row;
scaled from it, not measured: about 76 MB of typed arrays and 50 MB of other heap, compiled in
about 1.5 s. The stop times the
engine reads take about 13 bytes per call as columns (`StopTimeColumns`).

## Tests

`apps/server/tests/journeys/engine/`: a hand-written network (changes, past midnight, cancelled
and early or late trips, step-free, no way, ties, determinism, pickup and drop-off,
`transfers.txt`, stations, step-free changes, entrances and modes); the real subway capture read
through the platform's own GTFS index, whose expected times are read from its `stop_times.txt`
and whose ride follows the 1 train's shape of `shapes.txt`; shapes cut on loops and off the stops;
the step-free join on the station, equipment, inventory and outage captures; the composition
over a platform reader with a fallback; and the walks on the streets (`street-walks.test.ts`:
a change Newtown Creek makes too long, the search again, the departure moved, the wheelchair
profile, Transitous down, a station rule; `street-no-way.test.ts`: no way across the East River
from Roosevelt Island, for a change, from the start, to the destination and door to door, and a
walk not asked kept provisional) over the walk captures of `tests/fixtures/on-demand/`.
`apps/server/tests/live/engine.live.test.ts` plans one trip against Transitous.
