# Recorder

Records what MovIQ sees of the city and turns each day into its own reliability statistics, so
the position estimator learns how long each segment takes, the error of the provider's
predictions is measured, and Sara can answer "does the 7 usually run well at this time?" with a
figure, its number of measures and its dates. Inspired by Vektia's recorder, not copied.

## What it records

The recorder downloads nothing. The data platform already collects, validates and stores every
admitted version (`source_runs`, `source_snapshots`). While the worker holds its lease,
`runRecorder` reads the versions admitted since its cursor, in order, every few seconds, and
turns each one into compact events. A version whose copy was already replaced (real-time
sources keep one) or no longer matches its schema becomes a **gap** with its runs and reason.

| Event            | Written when                                                                | Sources                       |
| ---------------- | --------------------------------------------------------------------------- | ----------------------------- |
| `assign`         | A vehicle takes a trip, or its trip changes                                 | Bus Time, rail, Bee-Line…     |
| `gps`            | A vehicle moved 15 m or more, or names another next stop                    | Every GPS source              |
| `held`           | A bus keeps reporting the same place: a checkpoint each minute, with count  | Bus Time positions            |
| `train`          | A subway train changes the stop it is at or heading to, or its status       | 8 subway feeds                |
| `stn`            | Arrival (train `stopped at`) or departure (stop no longer ahead, next stop) | Subway, Bus Time              |
| `pred`           | The first prediction of a trip and stop inside each band of lead time       | Subway, Bus Time trips        |
| `open` …         | An incident opens, changes or closes (`open`, `change`, `close`)            | Alerts, elevators, FAA, NWS   |
| `sample`         | A road link, a forecast hour, a bike station or a cell of scooters changes  | NYC DOT, NWS, Citi Bike, GBFS |
| `version`, `gap` | Every version recorded; every run of versions that could not be             | All                           |

Every line carries the version it comes from (`v`) and the time of the datum (`t`, Unix
seconds). A departure deduced from a dropped stop keeps its window (`lo`, `hi`); it is `exact`
when the last time the feed gave for that stop falls inside it.

Files: `<RECORDING_DIR>/<YYYY-MM-DD>/<HH>/<source>.ndjson.gz`, by New York day and hour of the
data, appended one gzip member per pass. Vehicle state restarts every New York day so a day reads
on its own; incidents carry on through the `recorder_incidents` registry. In the database there
is only the cursor, the last version of each source, counts per day, gaps and the aggregates.

## Every night

`runNightly` reduces the previous New York day after 04:00 (`nightly/reduce.ts`):

- **Trajectories** of every trip, written to `<day>/reduced/trajectories.ndjson.gz`.
- **Segment run times** between consecutive stops, by line, stops, band (night, AM peak,
  midday, PM peak, evening) and kind of day, every sample kept. The subway is timed as the
  estimator counts a run, from leaving a stop to arriving at the next: the departure is the
  first moment the train reported itself no longer stopped there (`train` events), or else the
  time the feed gave for the stop when it dropped it, inside the window it was dropped in. In
  the B Division feeds a stop stays listed until the train has reached the next one (11/11/2026:
  13 s after that arrival, median), so a dropped stop there is never such a time, and a segment
  whose departure was not seen is not measured. The arrival is the train stopped at the next
  stop. Buses are timed departure to departure (Bus Time gives no arrivals), dwell included.
- **Bus speed by stretch** (`recorder_stretch_speeds`): from each GPS report of a bus to the next
  one of the same trip in which it moved, its straight distance over the seconds between them,
  by route, stretch of street (a square of 250 m crossed in one of four headings, found from the
  point alone: neither recorder reads the timetables' shapes), band and kind of day, in steps of
  0.5 m/s.
- **Error of `gps-plus`** (`recorder_tracking_errors`): the reports of each bus read again and
  replayed through the estimator's own bus filter, with the speeds just measured; each report
  judges where each of the ten before it would have had the bus drawn at that moment, by route
  and age (bands up to the five minutes the estimator follows), in steps of 5 m rounded up. A
  bus runs on its shape, so the distance along the path of its reports is its error.
- **Headways** at each stop, with their sums (regularity) and **bunching** (under a quarter of
  the median).
- **Prediction error** of the provider by lead time, as a histogram of seconds: the predicted
  arrival against the observed arrival on the subway, the predicted departure against the
  observed passage on buses.
- **Stoppages** with their proof: a bus at the same place for 5 min between two stops of its
  trip (a terminal is not one), or a subway segment 5 min slower than its median of the day.
- **Incident durations** by kind, type and line: Kaplan–Meier curves that count open ones.
- **Completeness**: hours without a recorded or unchanged version, and lost versions. An
  incomplete day is reduced from what was recorded and marked so; nothing is filled in.

Raw days older than `RECORDING_RETENTION_DAYS` are deleted; aggregates stay. Segment samples
are kept day by day for 35 days (the estimator reads 28), then each whole month is folded into
one row per segment, band and kind of day with its quantiles, its count and its dates: buses
give about one row per sample (some 20 MB a day, measured on 11/11/2026), a month folded far
less. `SegmentStats.history` reads those months. Speeds and errors are kept as counts by step,
one row per route, stretch and band (or route and age) a day, never point by point; bus speeds,
some hundred thousand rows and 11 MB a day (estimated on 11/11/2026 for 330 routes), are kept
for the same 35 days and then dropped.

## Reading

`reading.ts` and `reading-lines.ts` give typed readings over the last 28 reduced days:
`createSegmentStats(...).runTime(route, from, to, at)`, `createPredictionError(...).forHorizon(source, seconds)`,
`createLineReliability(...).at(route, at)` and `createIncidentDurations(...).typical(kind, type, route)`.
Each answers `{ status: 'ok', value, n, from, to, days, incompleteDays }` or
`{ status: 'no-data', n, reason }` below 20 measures: never a filler value.

`reading-estimation.ts` gives the position estimator whole distributions over the same days, at
the levels it asks for: `segmentDistribution` for one segment of one mode, and
`predictionErrorDistributions` for the feeds asked, by band of lead time, as observed minus
predicted. `reading-gps.ts` gives it `stretchSpeed`, the median speed of a stretch, and
`trackingErrors`, the p90 of the replayed error of every route by age. `live/estimation/recorded.ts`
keeps them in memory.

`routes.ts` serves `GET /api/ops/recorder` (`recorderStatusSchema` in the contracts).

## Adding a source

Write one file in `extractors/` with `extractorFor(definition, options, create)` and add it to
`extractors/index.ts`. Until then the source shows as not recorded.

The same extractors and nightly measures run on Cloudflare, 24 hours a day, in
`apps/recorder-cf`, which downloads the sources itself.

Tested in `apps/server/tests/recorder/`.
