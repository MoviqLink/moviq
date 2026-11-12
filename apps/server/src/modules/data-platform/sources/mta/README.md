# MTA sources

Nineteen definitions, exported together as `mtaSources` from `index.ts`. None needs a key.

| File                 | Sources                                                                                                | Data time                       |
| -------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `gtfs-static.ts`     | 7 timetables: subway, 5 boroughs, MTA Bus Company (`cold`)                                             | Date that starts `feed_version` |
| `subway-realtime.ts` | 8 subway feeds (`hot`), cancelled trips marked                                                         | `header.timestamp`              |
| `bus-realtime.ts`    | Bus Time positions with occupancy (level, passengers, capacity) and predictions (`hot`), cancellations | `header.timestamp`              |
| `alerts.ts`          | Service alerts for every MTA agency (`warm`)                                                           | `header.timestamp`              |
| `elevators.ts`       | Elevator and escalator outages, current and announced                                                  | Receipt: the feed has none      |

Shared pieces:

- `realtime-feed.ts`: decoding plus the header rules (a full dataset, never `DIFFERENTIAL`; a
  time present, not ahead of us, not behind the version served) and the stops-ahead shape shared
  by subway and buses. A trip whose `schedule_relationship` is CANCELED or DELETED is kept as
  `cancelled`, with or without stops; a running trip needs a stop ahead, and a feed with no
  running trip is refused as empty.
- `gtfs-static-*.ts`: the compact index schema, the row schemas, the checks and the parse. The
  ZIP directory must first list `agency`, `stops`, `routes`, `trips`, `stop_times` and a
  calendar, each with data. `gtfs-static-parse.ts` is the GTFS reader every timetable of the
  platform uses: tables at the root or in one folder, dated by the rules a source names, and
  with shapes or routing tables only when asked. The MTA timetables ask for both.
- Reading: the archive goes to the inflater in 64 KB pieces and the text to the CSV reader in
  32 KB pieces (`zip.ts`), which splits records with `indexOf` and makes no object per record
  (`csv.ts`); kept fields are copied, as a slice would keep its whole piece of text alive.
- Stop times (`gtfs-stop-times.ts`, `stop-times-runs.ts`, `stop-times-codec.ts`): each field is
  checked against the GTFS grammar by hand, without a Zod object per row; rows of one trip are
  put in `stop_sequence` order and encoded as soon as the trip's run ends, and a trip whose rows
  come back later is merged at the end. The index keeps the stop ids, the trip ids and all calls
  in one string: per call the change of stop index, the change of departure and the time at the
  stop, in the characters of encoded polylines. `transfers.txt` rows go with them (types 4 and 5,
  about staying on board, are left out) and `wheelchair_boarding`, when a file has it, on stops.
- Measured on 11/11/2026 with Node 24, compiled code, from the files of that day: the subway
  (562,943 stop times) parses in 0.6 s and is stored in 0.3 MB (0.2 MB the stop times), with a
  process peak of 211 MB after the parse and 250 MB after admission; Brooklyn (2,399,470 stop
  times) in 1.7 s and 1.4 MB (0.9 MB), with peaks of 317 and 454 MB. Read back, Brooklyn takes
  0.12 s and 35 MB of heap. Before, inflating the Brooklyn `stop_times.txt` in one piece alone
  took the process to 663 MB.
- `elevators.ts` declares `dataTimeSource: 'receipt'`: its freshness proves only that the feed
  answered, not that the state of each elevator or escalator was updated.
- MTA dates and wall-clock times are New York time, read with `infrastructure/clock/new-york.ts`.
- `provider.ts`: licence, attribution and the HTTP failures every MTA download can meet.

Normalised data is plain JSON (instants as ISO strings) and is read back through each
`dataSchema`. A vehicle without its trip and route is left out and counted, never shown.

Tests: `apps/server/tests/sources/mta/`, against the captures in `tests/fixtures/mta/`.
