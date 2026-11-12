# Estimation

Where each vehicle is now, with the best estimate the data allows and a margin only where the
recorder has measured one. `createPositionEstimator(statistics)` is the `PositionEstimator` that
`liveRoutes` draws with; without statistics every margin is null. `createRecordedStatistics`
gives it the statistics of MovIQ's own recorder (below).

| File                     | Responsibility                                                                |
| ------------------------ | ----------------------------------------------------------------------------- |
| `estimator.ts`           | Memory per vehicle, labels, margins, and the published position as fallback   |
| `gps-plus.ts`            | Buses: GPS reports followed along the shape of their trip (`gps`, `gps-plus`) |
| `kalman.ts`              | The 1-D Kalman filter: metres along the line and speed, with covariance       |
| `between-stations.ts`    | Subway: the departure seen between readings and the train between two stops   |
| `run-time.ts`            | Bayes on the recorded run time of a segment, and the motion of one run        |
| `line.ts`                | A shape as a line: placing a point on it and the point at a distance          |
| `statistics.ts`          | The port the recorder answers, the checks on its answers, `noStatistics`      |
| `recorded.ts`            | The port answered from the recorder's database, renewed every hour            |
| `recorded-segments.ts`   | What is asked, kept in memory and read in the background, one key at a time   |
| `recorded-gps.ts`        | Bus speeds by stretch of a shape, and the `gps-plus` margin by age            |
| `recorded-cloudflare.ts` | The last day the Cloudflare recorder published, by the keys the port asks     |
| `recorded-routes.ts`     | The subway feed each route runs in, as the feeds list their trips             |

## With GPS (buses, LIRR, ferries): `gps-plus`

Buses and ferries run with the bus filter below; trains (`rail`) with the train filter of Vektia.
A vehicle is followed along its line only when its timetable gives a verified shape for its trip.
LIRR, Metro-North and NYC Ferry timetables include shapes; when matching fails or the position is
off the shape, the vehicle remains at its reported GPS position.

- State: metres along the shape and speed, with their covariance. Each report is placed on the
  shape near where the filter expected it, then corrects the filter (Kalman update, r = 10 m).
- Between reports the speed settles on the typical speed of the stretch, for the day type and
  hour, when the recorder has it (time constant 40 s); otherwise the filter keeps its own speed.
  Process noise q = 0.3 m²/s³, speed held between 0 and 25 m/s.
- It stops at the next stop until the operator expects the bus to leave it, stands still when
  two reports are within 8 m, and is never drawn behind what it was drawn before.
- It starts again on a report on another shape, route or direction, more than 500 m from where
  it was expected, or more than 5 minutes after the last one.
- Labels: `gps`, the report itself, while what would be drawn is within 10 m of a report under
  60 s old; `gps-plus` otherwise. The margin is the p90 of `tracking.forAge`, measured by the
  recorder against the next report; the filter's own covariance is never shown.
- A bus without a shape, or reported more than 100 m off it, is drawn where it reported, `gps`.

## Without GPS (subway): `predicted`

- The MTA lists the stops a train has not left. When the first one changes from A to B, the
  train left A between the two readings, at the departure the MTA last gave for A, held inside
  that window. Until a departure is seen, or at a station, the train is drawn at the station.
- The B Division feeds keep a stop listed until the train has reached the next one (11/11/2026:
  13 s after that arrival, median). A train that reports a station after the first stop listed,
  on its line, has left that stop: the station is the stop not left, and the departure is the
  moment the train reported, held inside the window of the two readings. Stopped there, it is
  drawn at the station.
- Not arrived at B after t seconds: the recorded run time of A→B (`segments.runTime`) is
  conditioned on T > t. The MTA arrival time at B is a measurement, weighed by its recorded error
  for that horizon (`predictions.forHorizon`). Both are combined on a one-second grid.
- The position is the median run placed on the shape with the motion of a run (1.0 m/s² out of
  and into the stations); the margin is the wider side of the 10th to 90th percentile.
- Past the 95th percentile of the recorded run, the position carries a possible stoppage
  (`stall`) with its evidence: seconds elapsed, the usual (p95) and median seconds, n, the dates
  measured and the stop left; the card tells it in one sentence.
- Without a recorded run time, the segment is shared out by the MTA arrival time, with no margin.
- Never drawn behind what was drawn since the last departure.

## From the recorder

`createRecordedStatistics({ db, clock, reader, onError })` answers the port from the aggregates
the nightly process of `recorder/` writes in the same database, over its last 28 reduced days
(`recorder/reading-estimation.ts`, `recorder/reading-gps.ts`), and from the last day the
Cloudflare recorder published. The port is synchronous and the database is not, so:

- `start()` reads the prediction errors, the margins, the feed of each route and Cloudflare's
  day at once and then every hour
  (`renewEveryMs`, 1 h by default: the recorder reduces a day once, after 04:00 in New York);
  its timer does not keep the process alive, and `stop()` waits for the read in flight.
- A segment or a stretch is answered from memory. One not read yet, or not since the last
  renewal, answers what was kept (null the first time) and is read in the background, one at a
  time, for the next build of the city five seconds later: no build ever waits for the database.

| Asked                    | Answered from                                                        |
| ------------------------ | -------------------------------------------------------------------- |
| `segments.runTime`       | `recorder_segment_times`, subway, same route, stops, band and day    |
| `predictions.forHorizon` | `recorder_prediction_errors` of the feed the route runs in           |
| `segments.typicalSpeed`  | `recorder_stretch_speeds`: route, stretch of the shape, band and day |
| `tracking.forAge`        | `recorder_tracking_errors` of the route, buses only, by age          |

- Keys: the recorder writes the subway's route and stop ids as the feeds give them, the same the
  estimator asks with (`lirr:1` or `nyc-ferry:ER` are never recorded, and the subway's ids are
  asked for the subway only, so a bus of the same ids never answers). Its prediction errors are
  kept by feed: the route is matched to the feed whose trips list it.
- The seconds come at the nine levels of `LEVELS`, merged sample by sample over the days; the
  errors with the sign the estimator uses, observed minus predicted (the recorder keeps
  predicted minus observed). Fewer than 20 measures give null.
- `n` is the count of samples; `from` and `to` are the start of the first New York day measured
  and the end of the last, since the recorder keeps the day of each sample, not its moment.
- The subway is timed from leaving a stop to arriving at the next, as the estimator counts:
  the departure the train reported, or the one the feed gave inside its window (days reduced
  before 11/11/2026 were timed arrival to arrival, dwell included).
- A stretch is the square of 250 m around the point of the shape `meters` along it, in the
  heading of the shape there (four headings): the recorder finds it from the GPS reports alone.
  The typical speed is the median of every move measured there, in steps of 0.5 m/s.
- The margin is the p90 of the replayed error for the band of the age asked (0–15, 15–30, 30–45,
  45–60, 60–90, 90–120, 120–180, 180–240 and 240–300 s), or else of the first older band
  measured: an older report strays further, so it bounds the margin from above. A report every
  30 s leaves the first two bands without measures.
- The Cloudflare recorder publishes its last day (`moviq-recorder-stats`, read with the subway
  feeds): segments and prediction errors at the nine levels, the median speed of each stretch
  moved over 20 times or more, and the p90 of the replayed error. Of two measures of the same
  figure, the one with more measures is given, never a mix of both.

## Parameters

| Value          | Where from                                                                       |
| -------------- | -------------------------------------------------------------------------------- |
| q, r, 25 m/s   | Vektia `web/assets/fisica.js` (`gps.BUS`), bench of 07/11/2026, buses every 30 s |
| Trains         | Same file, `gps.params`: q 0.03 m²/s³, r 30 m, 140 km/h (Rodalies bench)         |
| 40 s, 8 m      | Same bench: speed lost in about 40 s; a repeated report is a bus standing        |
| 10 m, 60 s     | Vektia `web/assets/gps-plus.js` (`AQUI_M`, `RECIENTE_S`)                         |
| 500 m          | The impossible jump of Vektia's GPS+ (`GRANDE_M`), as MovIQ's plan sets it       |
| 100 m off line | Captures of 11/11/2026: 14 buses within 0.6 m of their shape; 293 platforms p90  |
|                | 0.5 m, the rest beyond 1.6 km (stops of another pattern)                         |
| 1.0 m/s²       | Vektia `web/assets/motor-llegadas.js`, metro model checked on its 05/11 bench    |
| 20 measures    | Vektia `docs/precision.md`: a cell with fewer is left empty                      |

The estimator learns from every build of the city, which `keepCityWarm` makes every 5 seconds
whether a screen is open or not: the memory of each vehicle lives in the process and is
forgotten 15 minutes after it was last seen. Route ids repeat between networks, so the feeds
key them by operator (`lirr:1`, `nyc-ferry:ER`) for the recorder's statistics.

Tests: `apps/server/tests/live-vehicles/estimation/`.
