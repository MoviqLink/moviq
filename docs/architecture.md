# Architecture

```text
 External sources           Data platform (core)                            Product modules
 ────────────────          ──────────────────────────────────────────      ─────────────────
 MTA GTFS / GTFS-RT ─┐     Source catalogue (typed definitions)            journeys
 Bus Time, alerts    │     Scheduler with three rhythms: cold/warm/hot     commerce
 Elevators, FAA, DOT ├───► Pipeline: fetch → validate → normalise →  ────► payments
 Weather, places     │       check → candidate → admit → activate          assistant
 Routing, flights   ─┘     State and provenance of every value             identity, operations
                           SQL (libSQL): local SQLite file or remote
                                        │
                                        └──── API (Hono) ◄──── Web
```

**No module calls an external source directly.** Everything goes through the data platform,
which records for each source when its data was produced, when it arrived, its last good
validation, its last error and the version being served. Every read returns the value with its
source, age and state, so a screen can say "alerts unavailable" instead of showing nothing.

## Two processes, one codebase

- **`api`** serves the web.
- **`worker`** collects data, watches active journeys, reconciles payments and runs jobs.

The worker holds a **lease** with an expiry in the database, so two workers never run the same
work. If a host allows a single process, both can run side by side from the same build. Both
processes validate their configuration, open the database and apply pending migrations before
doing anything else (see [operations](operations.md)).

## Persistence

One SQL client, libSQL, points either at a local SQLite file (development and tests) or at a
remote libSQL server (production) without code changes. Access goes through repositories;
migrations are numbered SQL files applied forward only. Money is stored in integer minor units
with its currency, and instants in UTC.

## Code map

| Path                                   | Responsibility                                          |
| -------------------------------------- | ------------------------------------------------------- |
| `packages/contracts`                   | Zod schemas at the boundary and the types derived       |
| `apps/server/src/main.ts`, `worker.ts` | Entry points; importing any other module starts nothing |
| `apps/server/src/bootstrap.ts`         | The shared life cycle of both processes                 |
| `apps/server/src/config`               | Configuration validated at start-up                     |
| `apps/server/src/infrastructure`       | Clock, database, HTTP plumbing, jobs and telemetry      |
| `apps/server/src/modules`              | Product and operations modules                          |
| `apps/server/migrations`               | Numbered SQL migrations                                 |
