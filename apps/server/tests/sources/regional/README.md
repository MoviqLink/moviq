# Regional and city transport source tests

| File                      | Covers                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalogue.test.ts`       | The 20 sources of `regional/`, `ferries/`, `bikes/`, `air/` and `sea/`: rhythm, freshness, versions, consumers, no key, provider-named failures |
| `rail-realtime.test.ts`   | LIRR and Metro-North captures; data time, train numbers, GPS or station, header rules                                                           |
| `rail-timetables.test.ts` | LIRR (receipt) and Metro-North (archive) captures; trip ids joining LIRR live trips; ZIP, row, reference and calendar faults                    |
| `path-arrivals.test.ts`   | RidePATH capture; arrival times, stations placed, unknown stations, empty answers                                                               |
| `path-alerts.test.ts`     | PATH alerts written for the tests; kind, lines named, send time, open or closed, sender never kept, empty lists                                 |

`captures.ts` loads the files of `tests/fixtures/` for this folder and for `ferries/`, `bikes/`,
`air/` and `sea/`. Each capture is accepted with its data time and coverage and survives a JSON round
trip through its `dataSchema`; faults are built from the captures or with `encodeGtfsRealtime`.
