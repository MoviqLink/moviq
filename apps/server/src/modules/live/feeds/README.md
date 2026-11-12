# Live feeds

Each file holds the feeds of one kind of source, built as `LiveModeFeed` (`feed.ts`): the live
sources a screen registers interest in, and `read(context)`, which returns the vehicles or places
shown, the count of those left out by reason, and every source read with its state.

| File               | Mode             | Sources                                                        |
| ------------------ | ---------------- | -------------------------------------------------------------- |
| `bus.ts`           | `bus`            | MTA Bus Time GPS and predictions, line and headsign from GTFS  |
| `subway.ts`        | `subway`         | The eight MTA feeds, without GPS (`predicted`)                 |
| `rail.ts`          | `rail`           | LIRR and Metro-North: GPS where sent, otherwise the stop named |
| `nyc-ferry.ts`     | `ferry`          | NYC Ferry GPS, speed and predictions, route from its timetable |
| `untimed.ts`       | bus, ferry, rail | Bee-Line, NY Waterway and Amtrak: counted, not drawn (below)   |
| `shuttles.ts`      | `shuttle`        | Port Authority airport shuttles and Passio GO, with counters   |
| `path.ts`          | `rail-station`   | PATH stations with the next trains RidePATH announces          |
| `aircraft.ts`      | `aircraft`       | ADS-B of adsb.lol, adsb.fi standing in, and the usual routes   |
| `ships.ts`         | `ship`           | AIS of Open Waters, ferries of Staten and Governors Island too |
| `bikes.ts`         | `bike-station`   | Bike share stations and status (GBFS), cited without the brand |
| `micromobility.ts` | `micromobility`  | Lime, Veo and Bird scooters and bikes parked, free to rent     |
| `airports.ts`      | `airport`        | JFK, LaGuardia and Newark with the FAA programs in force       |
| `index.ts`         | —                | `defaultFeeds()`: one line per feed                            |

Shared pieces: `movement.ts` (course and speed as reported or computed, the fields of other
modes left empty), `slow-read.ts` (a large slow source read at most once a minute) and
`subway-lines.ts` (the shape of a subway train from its trip id).

What is shown, and why:

- A vehicle on a line (bus, subway, rail, ferry) needs its line, destination and timed stops.
  Bee-Line, NY Waterway and Amtrak publish positions without any stop time, so their vehicles
  are counted (`no-predictions`, or `stale-position`) and their sources cited, never drawn.
- A shuttle runs no published line: it is shown as the shuttle of its operator, on the route the
  operator names (Passio GO), or by its published internal route number (Port Authority), and its card says that no stops or times are published. Passio GO dates reports
  to the minute, so no speed is computed from them.
- Aircraft and ships are shown with what they broadcast; the usual route of a callsign is
  where it usually flies, never today's flight plan. A position older than its source's
  `staleAfterMs` is left out.
- Places do not move: bike stations not installed or not reported for 15 minutes, and scooters
  reserved, disabled or not reported for 30, are left out. Lime and Bird give new ids in every
  answer (`stableId: false`): those vehicles are drawn anew with each answer, never followed.

A new source is one more feed in one of these files, or a file of its own, and one more line in
`index.ts`; feeds of the same mode are merged by `city.ts`.
