# Ferry sources

Eight definitions, exported together as `ferrySources` from `index.ts`. None needs a key.

| File                    | Sources                                              | Time of the data        | Position |
| ----------------------- | ---------------------------------------------------- | ----------------------- | -------- |
| `timetables.ts`         | NYC Ferry, NY Waterway, Staten Island timetables     | `feed_version`, archive | Piers    |
| `nyc-ferry-realtime.ts` | NYC Ferry positions and predictions (GTFS-RT, `hot`) | `header.timestamp`      | GPS      |
| `ny-waterway.ts`        | NY Waterway boat positions (GTFS-RT, `hot`)          | `header.timestamp`      | GPS      |
| `ferry-alerts.ts`       | NYC Ferry and NY Waterway alerts (GTFS-RT, `warm`)   | `header.timestamp`      | —        |

Timetables are read by `regional/timetable.ts`; the Staten Island Ferry file keeps its tables in
one folder (`siferry-gtfs_2026.1/`), which that reader accepts.

What the providers publish, as seen on 11/11/2026:

- NYC Ferry lists its GTFS, trip updates and alerts on https://www.ferry.nyc/developer-tools/;
  boat positions answer on the same host. The feeds name the trip only: route and headsign come
  from `nyc-ferry-gtfs`. A boat without a trip is left out and counted. An empty feed is valid:
  boats do not sail at night.
- NY Waterway runs on the same Connexionz system: positions name the trip, and route and
  headsign come from `ny-waterway-gtfs` (14 routes, 15 piers). It publishes no terms for its
  feeds, and the Mobility Database records no licence (11/11/2026).
- Both alert feeds are full datasets rebuilt every 2 minutes and were empty on 11/11/2026 (a
  15-byte header): an empty feed with a valid time is served as 0 alerts, unlike a failed
  download. Alerts take the shape of `mta-alerts` (`mta/alerts.ts`); their routes, stops and
  trips are ids of the operator's own GTFS, joined by the reader, never guessed.
- The Staten Island Ferry publishes only its timetable (NYC DOT): no positions, predictions or
  alerts of its own.

Tests: `apps/server/tests/sources/ferries/`, against the captures in `tests/fixtures/ferries/`.
