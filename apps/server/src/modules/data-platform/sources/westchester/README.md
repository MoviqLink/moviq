# Westchester sources

Two definitions of the Bee-Line System (Westchester County, with routes into the Bronx),
exported as `westchesterSources` from `index.ts`. No key.

| Source               | File                                    | Rhythm              | Time of the data  |
| -------------------- | --------------------------------------- | ------------------- | ----------------- |
| `bee-line-gtfs`      | `GTFS_GMV_WCDOT.zip` (4.3 MB)           | `cold`, daily       | Receipt           |
| `bee-line-positions` | GTFS Realtime `vehiclepositions` of GMV | `hot`, 1 min / 30 s | Newest bus report |

- `bus-positions.ts` reads a vehicle positions feed whose header is the second of the request
  (GMV here, Passio in `shuttles/`): the time of the data is the newest bus report, or the header
  when no bus runs. Each bus is a GPS position with its route, trip, direction, stop, bearing and
  speed (null when out of range); a vehicle without a route, a position or a report time, or
  reported after the header, is left out and counted. Differential feeds are refused.
- Buses join the timetable by `tripId`: all 35 trips of the capture of 11/11/2026 were in it,
  which names the route (`1 - COLLEGE-TARRYTOWN-WHITE PLAINS`) and the headsign.
- The timetable has no `feed_info.txt` and its entries carry the publisher's clock (two hours
  ahead of UTC on 14/10/2026), not New York's, so it is dated by receipt. A file with under 28
  routes or 1,400 stops (half of 57 and 2,836) is refused.

Terms: transit.land records the Transit API Service Terms of Service of the county planning site
(`TERMS_URL` in `bee-line.ts`) for both feeds; the page timed out three times from Europe (10
and 11/11/2026), so their text is not yet read.

Tests: `apps/server/tests/sources/westchester/`, against the captures in
`tests/fixtures/westchester/`.
