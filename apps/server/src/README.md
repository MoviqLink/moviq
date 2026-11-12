# Server sources

| Path              | Responsibility                                                   |
| ----------------- | ---------------------------------------------------------------- |
| `main.ts`         | Entry point of the api process                                   |
| `worker.ts`       | Entry point of the worker process                                |
| `worker-jobs.ts`  | What the worker does while it holds the lease                    |
| `bootstrap.ts`    | Shared life cycle: configuration, database, migrations, shutdown |
| `shutdown.ts`     | Signals from the very start, second signal and stop time limit   |
| `app.ts`          | Builds the HTTP application without opening a port               |
| `travel.ts`       | Builds the traveller services both processes share               |
| `commerce.ts`     | Builds commerce on the way, with its rules checked at start-up   |
| `config/`         | Configuration validated at start-up                              |
| `infrastructure/` | Technical building blocks shared by every module                 |
| `modules/`        | Product and operations modules                                   |

Only the two entry points start anything. Every other module can be imported without side
effects, and takes its clock, database and logger as arguments.
