# MTA source tests

| File                       | Covers                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `catalogue.test.ts`        | All 19 sources: unique ids, freshness order, rhythm, versions, no key              |
| `gtfs-static.test.ts`      | The 7 captures; required files, dates, references, calendars, coverage, ZIP faults |
|                            | and shapes: sequence order, repeated or lone points, missing shapes, old versions  |
| `gtfs-stop-times.test.ts`  | Stop times as `stop_times.txt` says, in sequence order however the rows come;      |
|                            | bad rows, broken references, transfers, `wheelchair_boarding`, old versions        |
| `stop-times-codec.test.ts` | The encoding of calls: every value back, cut or out-of-range text refused          |
| `zip.test.ts`              | A table far larger than one piece of the archive, streamed whole                   |
| `polyline.test.ts`         | Encoded polylines: the reference example, five decimals, malformed text            |
| `realtime-feed.test.ts`    | All 11 GTFS Realtime sources: full datasets read, differential feeds refused       |
| `subway-realtime.test.ts`  | The 8 subway captures; trains not yet departed; cancelled trips; header rules      |
| `bus-realtime.test.ts`     | Positions and predictions; every captured bus joins its trip; cancelled trips;     |
|                            | occupancy as published (level, passengers, capacity), never made up                |
| `alerts.test.ts`           | Alerts capture; English plain text, open periods, empty feeds                      |
| `elevators.test.ts`        | Capture dated by receipt; New York times across daylight saving; bad rows          |
| `csv.test.ts`              | The streaming CSV reader, rows and records, whatever the pieces of text            |

`captures.ts` loads the files of `tests/fixtures/mta/` and fixes the capture time. Faults are
built from the captures (a cut archive, a corrupted entry, a changed table) or with
`encodeGtfsRealtime`, so every refusal is checked by its code.
