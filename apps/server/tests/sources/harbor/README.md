# Harbor source tests

| File                           | Covers                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `catalogue.test.ts`            | The 6 sources: rhythm, freshness, versions, consumers, no key, receipt-dated ones      |
| `coast-guard-notices.test.ts`  | RSS capture; titles, ends and cancellations, point-of-contact lines left out, refusals |
| `pnct-vessel-schedule.test.ts` | Page of the tests; expected and actual times in New York time, stages, refusals        |
| `noaa-ports.test.ts`           | The 4 NOAA captures; units, quality flags, the request, older readings, refusals       |

Captures and the PNCT page written for the tests come from `tests/fixtures/harbor/` through
`../regional/captures.ts`; faults are built from them or written in the test.
