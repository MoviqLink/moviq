# Recorder tests

| File                            | Covers                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `statistics.test.ts`            | Quantiles, Kaplan–Meier with open incidents, New York bands and hours                    |
| `extractors.test.ts`            | Arrivals, departures in their window, GPS changes, holds, incident life                  |
| `recorder.test.ts`              | Recording real versions, a lost version as a gap, a source not recorded                  |
| `nightly.test.ts`               | A hand-made day: segments, headways, stoppages, errors, an incomplete day, months folded |
| `recording-config.test.ts`      | `RECORDING_DIR` and `RECORDING_RETENTION_DAYS`                                           |
| `positions.test.ts`             | GPS positions and counts of the other sources; cancelled trips left out                  |
| `recorder-stats-source.test.ts` | The source `moviq-recorder-stats` of the Cloudflare recorder                             |
| `reading-estimation.test.ts`    | Distributions for the estimator: reduced days of the window, one mode, 20 measures       |
| `bus-measures.test.ts`          | Bus speeds by stretch and heading; the replayed error of `gps-plus` by age               |
| `subway-runs.test.ts`           | Subway runs from the departure the train reported (B Division) or the feed gave          |
| `speed-retention.test.ts`       | Bus speeds kept 35 days; the replayed errors kept for good                               |

`support.ts` gives a migrated database, a recording folder and a term; `day-fixture.ts` writes
one hour of a day by hand, with known results, and `bus-day.ts` a morning of bus GPS.
