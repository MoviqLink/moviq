# Nightly reduction on Cloudflare

| File           | Responsibility                                                           |
| -------------- | ------------------------------------------------------------------------ |
| `reducer.ts`   | The job of one day, kept in SQLite; publishes, then deletes old raw days |
| `job.ts`       | Reads the day one gzip member at a time: trips first, then predictions   |
| `batches.ts`   | The lines of the day in steps of a few thousand passages                 |
| `aggregate.ts` | Segments, headways, stoppages, prediction errors, incidents, coverage    |
| `publish.ts`   | The JSON of the day, a few thousand rows a step                          |

The measures are those of `apps/server/src/modules/recorder/nightly/`, bus GPS included: its
first reading measures the speed of each stretch, the second replays the estimator (a replayed
line counts twice against a step), and the stretches become rows 2,500 a step. Tested in
`tests/nightly.test.ts` and `tests/nightly-buses.test.ts`, on the days the server's tests use.
