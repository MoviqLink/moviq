# Accessibility source tests

| File                         | Covers                                                                     |
| ---------------------------- | -------------------------------------------------------------------------- |
| `subway-stations.test.ts`    | The 496 stations of the capture, joined one to one to the subway capture   |
| `elevator-equipment.test.ts` | Equipment with the GTFS stations it serves; bad rows, cut lists            |
| `elevator-inventory.test.ts` | Status and stand-ins by level as written; bad rows, cut lists, the request |
| `subway-entrances.test.ts`   | The 2,120 entrances, each joined to stations of the subway capture         |

The captures are `subway-stations.json`, `elevator-equipment.json` and `elevator-inventory.json`
in `tests/fixtures/mta/`, as the three lists are published by the MTA.
The entrances are `subway-entrances.json` in `tests/fixtures/accessibility/`.
