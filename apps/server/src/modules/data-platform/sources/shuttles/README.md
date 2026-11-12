# Shuttle sources

Five definitions, exported as `shuttleSources` from `index.ts`. None needs a key.

| Source                      | File                                | Rhythm              | Time of the data  |
| --------------------------- | ----------------------------------- | ------------------- | ----------------- |
| `jfk-lga-shuttle-positions` | Passio GTFS Realtime of `jfkpanynj` | `hot`, 1 min / 30 s | Newest bus report |
| `ewr-shuttle-positions`     | Passio GTFS Realtime of `ewrpanynj` | `hot`, 1 min / 30 s | Newest bus report |
| `ewr-shuttle-gtfs`          | Newark GTFS by Passio               | `cold`, daily       | Receipt           |
| `passio-go-route-shapes`    | Passio GO public map routes         | `cold`, daily       | Receipt           |
| `passio-go-shuttles`        | `passiogo.com/mapGetData.php` (GET) | `hot`, 1 min / 30 s | Newest bus report |

- `passio-airports.ts`: the Port Authority shuttles of JFK, LaGuardia and Newark, read by
  `westchester/bus-positions.ts` (GPS by bus, with route and trip). Their timetables cannot name
  them yet: the JFK and LaGuardia GTFS lists routes and stops but no trips, and Newark's is
  complete and read by `passio-timetable.ts` for trip shapes.
- `passio-timetable.ts`: Newark GTFS shapes joined by vehicle trip ID and route ID. The feed
  version is not its publication time, so receipt dates the data and the calendar validates it.
- `passio-routes.ts`: published route points from the public map, kept as a single segment;
  disconnected paths are never joined. Receipt dates the response, not the route publication.
- `passio-go.ts`: the shuttles of NYU, Long Island University, the Free Downtown Connection,
  Hutch Metro Center and Hoboken, read as the public map of Passio GO reads them, with one GET
  and no key, cookie or special header. NYU has no GTFS Realtime feed (404). Each bus says its
  route by name and, where its counter works (`totalCap` above 0), the people on board and the
  capacity. Buses out of service, outdated, of another system or without a usable time are left
  out and counted.
- The map gives times as `10:22 PM` in New York, to the minute: a report is dated on the New York
  day of receipt, or the day before when that would be in the future (just after midnight). With
  no bus, the answer clock dates the data.

Terms: neither the Port Authority, Passio nor Passio GO publishes terms for these data, and
transit.land and the Mobility Database record no licence (11/11/2026).

Tests: `apps/server/tests/sources/shuttles/`, against the captures in `tests/fixtures/shuttles/`.
