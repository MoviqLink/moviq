# Server tests

| File                               | Covers                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| `config.test.ts`                   | Configuration rules, integration states and secrets                                   |
| `logger.test.ts`                   | Structured logs and redaction                                                         |
| `database.test.ts`                 | Concurrent writes, lock waits, rollbacks and row validation                           |
| `migrations.test.ts`               | Reading, applying and checking migrations                                             |
| `lease.test.ts`                    | Lease operations, with expiry judged after a lock wait                                |
| `leadership.test.ts`               | Leader terms: one at a time, hand-over, fences and outages                            |
| `leadership-outages.test.ts`       | Leader terms when the database fails, is slow or hangs                                |
| `heartbeat.test.ts`                | The hosting probe                                                                     |
| `health.test.ts`                   | `/healthz`, `/readyz`, request ids and error responses                                |
| `shutdown.test.ts`                 | Signals, second signal and the stop time limit                                        |
| `http-client.test.ts`              | The shared HTTP client: identity, ETag, limits, timeouts, errors                      |
| `data-platform-health.test.ts`     | The eight states and their evidence                                                   |
| `data-platform-schedule.test.ts`   | Intervals, interest, back-off, breaker and Retry-After                                |
| `data-platform-collector.test.ts`  | The admission chain against a real HTTP server and database                           |
| `data-platform-reader.test.ts`     | The version served, and each version validated once by its own definition             |
| `data-platform-scheduler.test.ts`  | The collection loop: due sources, lanes, manual refreshes                             |
| `data-platform-view.test.ts`       | Product features in the control room: step-free needs every one of its sources        |
| `ops-api.test.ts`                  | Control room sessions, roles, actions and their audit                                 |
| `ops-money.test.ts`                | Money in doubt: each kind, escalation at the thresholds, errors cleaned, session      |
| `traveller-sessions.test.ts`       | Anonymous device sessions, created only on actions                                    |
| `journeys.test.ts`                 | Backward planning, journeys owned by their traveller, the event stream                |
| `journeys-apply.test.ts`           | Taking a free alternative; a paid one only after its payment                          |
| `journeys-watch.test.ts`           | On track, at risk, late, missed connections, alerts, sources down                     |
| `journeys-watch-loop.test.ts`      | The worker's watch loop and what journeys sell                                        |
| `journeys-alternatives.test.ts`    | Alternatives, with the demo partner taxi at official rates                            |
| `journeys-flight.test.ts`          | Flights triangulated: AeroDataBox, boarding pass, FAA and ADS-B, and their facts      |
| `journeys-flight-watch.test.ts`    | The flight in the watch: new deadline, gate, FAA, take-off, sources down              |
| `journeys-step-free.test.ts`       | Step-free check of an itinerary; elevator and source-down incidents; refusals         |
| `journeys-step-free-plan.test.ts`  | A step-free plan with its check; the refusal said plainly                             |
| `journeys-walks.test.ts`           | Estimated walks: provisional plans, changes not sure for Sara, step-free order        |
| `journeys-step-free-watch.test.ts` | The watch of a step-free journey: D17 out, refused alternatives, outages down         |
| `taxi-fare.test.ts`                | The official NYC TLC rates and surcharges                                             |
| `new-york-time.test.ts`            | New York dates and times across daylight-saving changes                               |
| `journeys/`                        | The own routing engine (RAPTOR) on hand-made and captured timetables                  |
| `live-vehicles/`                   | Explore: vehicles by mode, motion, and the position estimator                         |
| `journeys-fares/`                  | OMNY fares: the transfer window and the weekly cap                                    |
| `on-demand/`                       | Routing, address search and flights against captured answers                          |
| `assistant/`                       | Sara: both modes, the budget, privacy and the OpenAI adapter                          |
| `city-layers/`                     | City layers on real captures, camera pictures (only listed cameras) and parking signs |
| `payments/`                        | PayPal client, ledger, API, webhooks, reconciliation, holds and payouts               |
| `commerce/`                        | Commerce on the way: protocol, offer check, holds, pickup codes, refunds and payouts  |
| `recorder/`                        | Recording, gaps, the nightly reduction and every statistic, on hand-made days         |
| `sources/`                         | Each source against captures of real responses                                        |
| `database-location.test.ts`        | Where `DATABASE_URL` points, encoded paths included                                   |
| `process.test.ts`                  | The real entry points as child processes, two workers too                             |

`support/` holds the shared test helpers. See [testing](../../../docs/testing.md).
