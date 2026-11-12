# Data platform

The core of MovIQ: no product module calls a provider directly. Every source is collected,
validated and served here, and every value it serves carries its source, its age and its state.

| File                              | Responsibility                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `definition.ts`                   | `SourceDefinition`: identity, licence, rhythm, freshness, limits, parse and checks  |
| `catalog.ts`                      | The list of sources collected                                                       |
| `attempt.ts`                      | One attempt: download, validate, normalise, check; every refusal with its code      |
| `collector.ts`                    | Commits what an attempt learnt (snapshot, run, facts, incident) in one fenced write |
| `health.ts`                       | The rules that turn facts into one of the eight states, with its evidence           |
| `schedule.ts`                     | When a source runs next: interval, interest, back-off, breaker, Retry-After         |
| `scheduler.ts`                    | The leader's loop: two lanes, first reads before retries, refreshes, housekeeping   |
| `interests.ts`                    | Explicit, expiring interest that speeds a source up                                 |
| `snapshots.ts`, `health-store.ts` | Storage of served versions, facts, runs and incidents                               |
| `view.ts`                         | What the control room sees: states recomputed at read time, feature availability    |
| `credentials.ts`                  | Which credentials a source lacks, and their values for the request only             |
| `formats/`                        | Shared decoders (GTFS Realtime)                                                     |
| `sources/`                        | One module per provider family                                                      |

A bad candidate never replaces the served data. Freshness is measured on the time of the data,
not of the download, and is recomputed on every read, so a served copy keeps ageing. See
[ADR 0007](../../../../../docs/adr/0007-snapshots-and-facts.md).
