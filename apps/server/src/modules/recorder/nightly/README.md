# Nightly process

Reduces one recorded New York day after 04:00 the next morning, from its files and the incident
registry, into aggregates kept for good. Every figure keeps its number of measures and its day;
an incomplete day is reduced from what was recorded and marked so.

| File                    | Responsibility                                                       |
| ----------------------- | -------------------------------------------------------------------- |
| `nightly.ts`            | The loop: which day is due, then the retention of raw days           |
| `reduce.ts`             | One day: two passes over its files, the measures, the reduced copy   |
| `day-reader.ts`         | The events of a source in a day, each version read once              |
| `trajectories.ts`       | Each trip: its passages (timed or only windowed), GPS reports, holds |
| `segments.ts`           | Run times between consecutive stops                                  |
| `bus-reports.ts`        | Each bus's GPS reports in order, joined to its trip                  |
| `bus-measures.ts`       | Both readings of bus GPS: speeds first, then the estimator replayed  |
| `stretch-speeds.ts`     | Bus speed by route and stretch of street (250 m, four headings)      |
| `tracking-errors.ts`    | The error of `gps-plus` positions against the next report, by age    |
| `headways.ts`           | Headways, regularity sums and bunching                               |
| `predictions.ts`        | The provider's prediction error by lead time                         |
| `stoppages.ts`          | Stoppages with their proof; a terminal is not one                    |
| `incident-durations.ts` | Kaplan–Meier curves by kind, type and line                           |
| `completeness.ts`       | Hours covered and versions lost, source by source                    |
| `calendar.ts`           | New York days, hours, bands and kinds of day                         |
| `statistics.ts`         | Quantiles (type 7) over values and over counts                       |
| `survival.ts`           | The Kaplan–Meier estimator                                           |
| `aggregates-store.ts`   | Writing a day's aggregates and its nightly record                    |
| `segment-months.ts`     | Folding segment samples older than 35 days into one row per month    |

The same files reduce the day on Cloudflare (`apps/recorder-cf/src/nightly/`). Tested in
`apps/server/tests/recorder/` (`statistics`, `nightly`, `bus-measures` and `subway-runs`).
