# Street source tests

| File                | Covers                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `today.test.ts`     | Closures, events and permits of the New York day; New York times, permits not closures   |
| `lists.test.ts`     | Meters (active apart), chargers (five boroughs, New Jersey with its key), defibrillators |
| `landmarks.test.ts` | LPC designations, coordinates, duplicates, dates and cut answers                         |
| `restrooms.test.ts` | Public restrooms: only those in service, once each; hours as published; keys and access  |
| `on-demand.test.ts` | EPSG:2263 against the meters' own coordinates; signs by tile; stipulations by permit     |

The captures are in `tests/fixtures/street/`; the on-demand readers answer through the HTTP stub
of `../../on-demand/support.ts`.
