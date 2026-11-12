# Recorder on Cloudflare: tests

| File                    | Covers                                                                         |
| ----------------------- | ------------------------------------------------------------------------------ |
| `gtfs-rt.test.ts`       | The decoder against protobufjs on every capture; each source's data both ways  |
| `recorder.test.ts`      | Parts over alarms, never twice, back-off, failures in the audit, hourly upload |
| `nightly.test.ts`       | The server's hand-made day gives the same figures; publication and retention   |
| `nightly-buses.test.ts` | The same bus speeds and replayed errors as the server; a large day in steps    |
| `routes.test.ts`        | The read key, the statistics and the audit                                     |

`support.ts` gives SQLite (`node:sqlite`) and R2 in memory, and the captures of `tests/fixtures/`.
