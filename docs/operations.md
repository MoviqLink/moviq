# Operations

## Processes

| Process  | Command (compiled)     | Command (source)     | Does                               |
| -------- | ---------------------- | -------------------- | ---------------------------------- |
| `api`    | `npm start`            | `npm run dev`        | Serves HTTP                        |
| `worker` | `npm run start:worker` | `npm run dev:worker` | Runs jobs while it holds the lease |

On start both processes validate the configuration, open the database and apply pending
migrations, then run until `SIGTERM` or `SIGINT`, when they stop cleanly: the API closes its
port, the worker releases its lease, and the database is closed. A signal that arrives during
start-up stops the process once the current step ends, before it serves anything. A second
signal, or a stop that takes longer than 15 s, forces the exit with code `1`.

| Exit code | Meaning                                                    |
| --------- | ---------------------------------------------------------- |
| `0`       | Stopped cleanly after a signal, also during start-up       |
| `1`       | Failed (database or migration error, see logs), or forced  |
| `78`      | Configuration error: nothing was opened, not even the port |

## Configuration

Read from the environment once, at start-up. `.env.example` lists every variable. A blank value
counts as not set. Problems name the variable and the rule, never the value.

| Variable                   | Default                               | Rule                                                                         |
| -------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| `APP_ENV`                  | `development`                         | `development`, `test` or `production`                                        |
| `APP_VERSION`              | `development`                         | Shown by `/readyz`                                                           |
| `HOST`                     | `127.0.0.1` (`0.0.0.0` in production) |                                                                              |
| `PORT`                     | `8080`                                | 1 to 65535                                                                   |
| `LOG_LEVEL`                | `info`                                | `debug`, `info`, `warn` or `error`                                           |
| `DATABASE_URL`             | `file:data/moviq.db`                  | `file:`, `libsql://` or `https://`; see below                                |
| `DATABASE_AUTH_TOKEN`      | none                                  | For remote libSQL servers                                                    |
| `PAYPAL_ENV`               | `sandbox`                             | `sandbox` or `live`                                                          |
| `PUBLIC_DEMO`              | `false`                               | `true`/`false`/`1`/`0`                                                       |
| `ADMIN_TOKEN`              | none                                  | At least 32 characters                                                       |
| `OPS_VIEWER_TOKEN`         | none                                  | At least 32 characters, different from `ADMIN_TOKEN`                         |
| `MERCHANT_ACCESS_TOKEN`    | none                                  | Private demo-panel key, 32–256 characters; absent disables sign-in           |
| `PUBLIC_ORIGIN`            | request origin                        | Public HTTP(S) origin, no path or trailing slash; set behind TLS termination |
| `WORKER_LEASE_TTL_SECONDS` | `30`                                  | 3 to 300; renewed every third                                                |
| `WORKER_HEARTBEAT_SECONDS` | `30`                                  | 1 to 3600                                                                    |
| `RECORDING_DIR`            | none                                  | Absolute folder of the recording; see below                                  |
| `RECORDING_RETENTION_DAYS` | `7`                                   | 1 to 90 days of raw recording, besides today                                 |

These combinations stop the process with exit code 78:

- `APP_ENV=production` without `ADMIN_TOKEN` or without an explicit `DATABASE_URL`;
- `PAYPAL_ENV=live` outside production, with `PUBLIC_DEMO`, or without both PayPal credentials.

### Integration credentials

Credentials never block the build or the start-up. Each integration is `configured`, `missing`
(no variable set) or `incomplete` (some set), and the start-up log lists the missing variables by
name. Features of an integration that is not configured report themselves as unavailable.

| Integration       | Variables                                                             |
| ----------------- | --------------------------------------------------------------------- |
| `paypal`          | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`                            |
| `paypal-webhooks` | `PAYPAL_WEBHOOK_ID`                                                   |
| `openai`          | `OPENAI_API_KEY`                                                      |
| `mta-bus-time`    | `MTA_BUSTIME_KEY`                                                     |
| `aerodatabox`     | `AERODATABOX_KEY`                                                     |
| `channel3`        | `CHANNEL3_API_KEY`                                                    |
| `ticketmaster`    | `TICKETMASTER_API_KEY`                                                |
| `duffel`          | `DUFFEL_TOKEN`                                                        |
| `nlr`             | `NLR_API_KEY`                                                         |
| `moviq-recorder`  | `RECORDER_URL`, `RECORDER_READ_TOKEN`                                 |
| `doordash`        | `DOORDASH_DEVELOPER_ID`, `DOORDASH_KEY_ID`, `DOORDASH_SIGNING_SECRET` |

## Health

| Endpoint       | Answers                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz` | `200 {"status":"ok"}` while the process runs. It does not touch the database.                                                     |
| `GET /readyz`  | `200` when a real database read succeeds within 2 s and every migration is applied; `503` otherwise, with the reason in `checks`. |

A process that answers is not proof of a healthy database, so platform readiness probes must use
`/readyz`.

## Worker lease and hosting probe

Any number of workers can run; only the one holding the `worker` lease does the work. It renews
the lease every third of its duration. If the database cannot confirm the lease before it would
expire, the worker stops its work at once, and every write of that work is fenced: it commits
only while the lease is still held with the same fencing token. A worker killed without warning
is replaced within one lease period plus one renewal interval (about 40 s with the defaults).

While it leads, the worker writes a heartbeat to `worker_heartbeats` every
`WORKER_HEARTBEAT_SECONDS`, with its holder id, fencing token and lock latency, and keeps seven
days of them. Gaps show restarts and outages of the host; a new fencing token marks a new leader.

## Data sources

The worker collects every source of `apps/server/src/modules/data-platform/catalog.ts` while it
holds the lease. Each source has a base interval and, if it has one, a faster interval while an
interest is active. Failures back off from 5 s, doubling, and after five in a row a breaker
spaces retries 5 to 30 minutes apart. A refused credential (401 or 403) is retried hourly; a
missing one is never tried. Timetables run one at a time in their own lane.

Each run is kept 30 days in `source_runs`; each change of state in `source_incidents`. The scheduler looks for due sources every 2 s, reading about 30 rows each time, which keeps a free libSQL plan (500 million rows read a month) far from its limit.

## Recorder

While it leads, the worker also records what the data platform admits. It downloads nothing:
every 5 s it reads the versions admitted since its cursor, in the order of `source_runs`, and
appends compact events (positions that changed, arrivals and departures, sampled predictions,
incidents opening and closing) to `<RECORDING_DIR>/<YYYY-MM-DD>/<HH>/<source>.ndjson.gz`, by the
New York day and hour of the data. Each write is one gzip member, so `gzip -dc` reads a file
whole even if the process stopped mid-hour. A version replaced before it could be read is
written as a gap with its runs and its reason, never skipped in silence.

Without `RECORDING_DIR` neither the recorder nor its nightly process runs, and
`GET /api/ops/recorder` says so. At 04:00 in New York the nightly process reduces the day
before into aggregates kept in the database, writes the trips of the day to
`<day>/reduced/trajectories.ndjson.gz` and deletes raw days older than
`RECORDING_RETENTION_DAYS`. See `apps/server/src/modules/recorder/README.md`.

### Recorder on Cloudflare

`apps/recorder-cf` records 24 hours a day on Cloudflare's free plan, downloading the sources
itself, and publishes each New York day's statistics as `stats/latest.json`. MovIQ reads them as
the source `moviq-recorder-stats` with the integration `moviq-recorder`: `RECORDER_URL` is the
Worker's address and `RECORDER_READ_TOKEN` its `TOKEN_LECTURA`. Without them the source is
`misconfigured` and the estimator and Sara keep to the server's own recording. Its status, daily
audit and statistics are private routes (401 without the key); publishing is `publicar.sh`. See
`apps/recorder-cf/README.md`.

## Control room

`/api/ops` serves the control room. Sign in with `POST /api/ops/session` and an operations token:
`ADMIN_TOKEN` can act (refresh a source, cancel a job), `OPS_VIEWER_TOKEN` can only look. The
session is an `HttpOnly`, `SameSite=Strict` cookie scoped to `/api/ops` (and `Secure` in
production) that lasts 12 hours. Every action needs a reason and is recorded in `audit_log` with
the actor, in the same transaction as the action.

| Endpoint                                             | Gives                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /api/ops/summary`                               | Features and their state, sources by state, jobs and the worker probe        |
| `GET /api/ops/sources`, `/sources/:id`               | Every source with its state and evidence; licence, failures, runs, incidents |
| `POST /api/ops/sources/:id/refresh`                  | A manual refresh job, carried out by the worker (admin)                      |
| `GET /api/ops/jobs`, `POST /api/ops/jobs/:id/cancel` | Jobs, and cancelling a pending one (admin)                                   |
| `GET /api/ops/worker`                                | The lease holder and the heartbeats of the last 24 h                         |
| `GET /api/ops/audit`                                 | The audit log                                                                |

## Logs

One JSON object per line on standard output: `time` (UTC), `level`, `msg`, the process and
version, and the fields of the event. Each request gets an `x-request-id` (a well-formed incoming
one is reused) and one `request` line with method, path, status and duration. Query strings are
never logged.

## Database

A relative `file:` path is resolved against `apps/server`, whatever folder the process is started
from, so the API and the worker always share one file. Both `file:relative/path` and
`file:///absolute/path` (percent-encoded) are understood. In-memory databases are refused, since
each new connection would see an empty one. In production `DATABASE_URL` must be a remote libSQL
URL or an absolute file path.

Migrations live in `apps/server/migrations` as `NNNN_name.sql` and only move forward. Each one is
applied in its own transaction and recorded with its SHA-256 in `schema_migrations`. A migration
edited after it was applied, or a database that is ahead of the code, stops the start-up instead
of guessing.

## PayPal callback activation

The listener is `POST /api/payments/webhooks`. It remains disabled until `PAYPAL_WEBHOOK_ID`
is configured. Registration needs the final externally reachable HTTPS API origin; localhost
cannot receive PayPal's deliveries. Use the same sandbox REST app as `PAYPAL_CLIENT_ID` and
`PAYPAL_CLIENT_SECRET`, register `<public-api-origin>/api/payments/webhooks`, and keep the returned
webhook ID in the deployment's environment. Register the order approval and capture completion,
denial and refund events used by the direct payment ledger. The listener verifies the signature
through PayPal and reads the order back before settling it. The worker separately reconciles
merchant authorizations, releases, refunds and payouts; registering a webhook does not replace it.

Before exposing the final deployment, configure `PUBLIC_ORIGIN`, register the sandbox callback,
and verify a signed delivery, a repeated delivery, and rejection of an unsigned request. Then run
`npm run e2e:paypal` against the sandbox. Local signature, retry and duplicate-delivery regressions
are in `apps/server/tests/payments/webhooks.test.ts`; they do not prove remote delivery reachability.
See [PayPal's webhook documentation](https://developer.paypal.com/api/rest/webhooks/).
