# Regional rail sources

Six definitions, exported together as `regionalSources` from `index.ts`. None needs a key.

| File                 | Sources                                                       | Time of the data                   | Position       |
| -------------------- | ------------------------------------------------------------- | ---------------------------------- | -------------- |
| `rail-timetables.ts` | LIRR and Metro-North timetables (`cold`)                      | Receipt (LIRR), archive time (MNR) | Stations       |
| `rail-realtime.ts`   | LIRR and Metro-North live trains, MTA GTFS Realtime (`hot`)   | Newest train report (LIRR), header | GPS or station |
| `path-arrivals.ts`   | PATH arrivals at the thirteen stations, from RidePATH (`hot`) | Newest `lastUpdated`               | Station        |
| `path-alerts.ts`     | PATH service alerts from panynj.gov (`warm`)                  | Receipt: the list has none         | —              |

Shared piece: `timetable.ts` gives these files, and the ferry and Bee-Line ones, the common GTFS
reader of `mta/gtfs-static-parse.ts` (tables at the root or in one folder), dated by the one rule
each source names (`feed_version`, the archive or receipt), with shapes and without stop times or
transfers, which nothing reads from them yet. It also passes on the shared checks of
`mta/gtfs-static-checks.ts` and lists the failures of such a file.

What the providers do, as seen on 11/11/2026:

- LIRR makes its header on each request, so the time of the data is the newest train report.
  Its trip updates list the whole trip, past stops included; `finalStopId` is where it ends.
- Metro-North stamps every train with the header time, so a train has no report time of its
  own (`observedAt` is null). Its trip ids do not join its timetable (0 of 114); the entity id is
  the train number, `trip_short_name` in the timetable (114 of 114), kept as `trainNumber`.
- A train is `gps` when it sends coordinates and `station` when it only names its stop.
- PATH publishes no GTFS Realtime feed and no current GTFS: the last one (Trillium, for the
  Port Authority) ended on 01/06/2026. Stations are placed from its `stops.txt`; arrivals are
  `lastUpdated` plus `secondsToArrival`.
- PATH alerts give a subject, a text, a template, an Open or Closed incident state and the send
  time (`sentdate2`, in milliseconds), but no structured scope: `linesNamed` lists the four lines
  the words name, affected or not. The sender's name (`SentBy`) is never read.

Tests: `apps/server/tests/sources/regional/`, against the captures in `tests/fixtures/regional/`.
