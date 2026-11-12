# Airport board tests

Against a JFK board written for the tests in AeroDataBox's shape (AeroDataBox allows no copy kept
over 7 days) and the real ADS-B answer around New York of 11/11/2026 (`tests/fixtures/on-demand/`),
and AeroDataBox's official schema of the FIDS. Values built from the schema's field names cover
what the board does not show, and say so.

| File                   | What it checks                                                                  |
| ---------------------- | ------------------------------------------------------------------------------- |
| `fids-capture.test.ts` | The documented request, the fields read, the board in the public contract       |
| `boards.test.ts`       | Asked only when read, every 3 hours, kept with its time, one count with flights |
| `budget.test.ts`       | The boards' share of the units and the README's accounts, line by line          |
| `match.test.ts`        | Call signs, and the board crossed with ADS-B: phases, estimates, unmatched      |
| `board.test.ts`        | The service: contract, attribution, the FAA unread, ADS-B down, adsb.fi in      |
| `routes.test.ts`       | `GET /api/airports/:code/board` and its refusals                                |
| `rebooking.test.ts`    | The next departures to the same destination from the three airports             |

`support.ts` reads the board and the capture and gives a reader and boards for tests. Its usual routes are the
three adsbdb gave on 11/11/2026 in the audit of the flight sources.
