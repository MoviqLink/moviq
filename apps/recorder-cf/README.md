# Recorder on Cloudflare

MovIQ's recorder for 24 hours a day, on Cloudflare's free plan, without the MovIQ worker being
on. A Worker (`nyc-rec-24h`, a neutral name: it may reach providers in Cloudflare's `CF-Worker` header) with two Durable Objects on SQLite and an R2 bucket downloads
the city's live sources itself, records what changed as compact events, audits every answer,
and every night reduces the day into the statistics MovIQ reads as the source
`moviq-recorder-stats`. It reuses, without copying, each source's `request`, `parse`, `check`
and `dataSchema` and the recorder's extractors and nightly measures of `apps/server`.

## How it runs

| Piece                         | What it does                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `RecorderObject` (one)        | Its alarm wakes at least every 8 s, downloads what is due, and records parts within 9 ms |
| `ReducerObject` (one)         | After 04:00 in New York, reduces yesterday in steps, one per alarm, 200 ms apart         |
| R2 `moviq-recordings`         | `raw/<day>/<HH>/<source>.<n>.ndjson.gz` (member lengths as metadata), `audit/`, `stats/` |
| Cron `*/5 * * * *`            | Sets the alarms again if they were lost (the reducer's while a day waits)                |
| `GET /status`, `/stats/<day>` | Private (`Authorization: Bearer <TOKEN_LECTURA>`, 401 without it); also `/stats/latest`  |
| `GET /audit/<day>`            | The audit of a day, hour by hour, as text                                                |

The free plan gives each alarm 10 ms of CPU and a day 100,000 rows written. So a feed is split
into stable parts (by entity id, or by trip where a trip's update and train come apart), each
part predicts its CPU from its size, and an alarm reads parts until 9 ms of predicted CPU; parts
left wait in memory and the next alarm comes at once. With nothing due it still wakes every 8 s:
an idle Durable Object may hibernate after 10 s and lose its memory. Events are gzip members
kept in memory and written as one SQLite row every 30 s; each hour that ended is uploaded in
steps of 128 KiB. After a restart the object reads one part per alarm while its code warms up,
and the audit says so. The status counts the object's starts and the rows written in the UTC
day (alarms, buffer rows and their deletion, states), and the audit says when they reach 90 %
of the free 100,000. Cadences, parts and costs are in `src/sources.ts`.

## Audit and storage

Every part is refused when its bytes are the last ones recorded (never twice), when its source's
parse or checks refuse it, when its time is impossible (ahead of our clock, older than the last
version) or when it breaks the source's schema; a feed whose data time stops moving for ten
cadences (five minutes at least) is noted as frozen and as thawed; a vehicle that jumps faster
than any can (70 m/s on the ground, 300 m/s in the air) is noted with both reports. Failures
wait twice as long after three in a row, up to five minutes, ± 20 %. The audit lines of each
hour go to `audit/<day>/<HH>.txt`, the reduction's to `audit/<day>/reduced.txt`. Requests carry
the common client's generic browser identity and nothing else; no key is ever in a request,
an error or the copy.

## Every night

`src/nightly/` reads the day one object at a time, in the order written (one R2 read,
decompressed member by member, since a gzip stream of the platform reads one member), first the
trips and the speed of buses by stretch, then the predictions judged against them and the bus
reports replayed through the position estimator, measures the lines a few thousand passages at
a time (a busy line stop group by stop group) and the stretches 2,500 at a time, writes the day
5,000 rows a step, and publishes `stats/<day>.json` and `stats/latest.json`
(`recorderStatsSchema` in `packages/contracts`: run times and prediction errors at the nine
levels of the estimator with their counts, the error with its sign, the median speed of each
stretch moved over 20 times or more, and the p90 of the replayed `gps-plus` error by route and
age), then deletes raw days older than `RETENTION_DAYS`. It gives the same figures as
`apps/server/src/modules/recorder/nightly/`, whose code it runs.

## Checks

- `npm run cpu-budget -w @moviq/recorder-cf`: every part of real answers (`tools/fixtures-cpu/`),
  the upload, the nightly steps (lines, bus speeds, bus replay, stretches, a batch, writing a day
  of 120,000 rows and its document), and the rows of a day, against their budgets.
- `npx vitest run apps/recorder-cf`, `npx tsc -p apps/recorder-cf`.
- `./publicar.sh` runs all three, then publishes with `wrangler` from your PATH.
  Set `WRANGLER_BIN` to use a different executable (for example an account-specific wrapper).

The GTFS Realtime decoder of `src/gtfs-rt/` stands in for protobufjs inside the bundle
(`[alias]` in `wrangler.toml`): Workers refuse the `Function()` protobufjs builds decoders with.
Its tests decode every capture of `tests/fixtures/` exactly as protobufjs does.

## Deployment prerequisites

Install the Cloudflare Wrangler CLI and authenticate it against your own account. Create the
R2 bucket named in `wrangler.toml`, or change that name to your own bucket. Set the read token
with `wrangler secret put TOKEN_LECTURA` before exposing the recorder. Account credentials and
the read token stay outside the source repository. The API consumes this recorder through
`RECORDER_URL` and `RECORDER_READ_TOKEN`; it does not depend on a particular Cloudflare account.
