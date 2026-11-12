# Bike share sources

Two definitions from Citi Bike's GBFS 2.3 feed, exported as `bikeSources` from `index.ts`. No key.

| Source                     | File                       | Rhythm               | Time of the data |
| -------------------------- | -------------------------- | -------------------- | ---------------- |
| `citi-bike-stations`       | `station_information.json` | `cold`, every 6 h    | `last_updated`   |
| `citi-bike-station-status` | `station_status.json`      | `hot`, 2 min / 1 min | `last_updated`   |

Bikes are counted by station: the status says how many bikes, e-bikes and free docks a station
has, and the station file says where it is. They join on `stationId`.

- A row that does not validate is left out and counted; fewer than 1,260 usable stations (half
  of the 2,519 of 11/11/2026) refuses the file.
- Lyft writes `last_reported` 86400 for stations that never reported; any report before the
  system started (2013-05-01) is read as none.
- Only the totals are read: the per-type counts disagreed with them in 77 stations that day.

Licence: the Citi Bike Data License Agreement allows the data inside a product, not as a
stand-alone dataset, and not the use of the Citi Bike marks.

Tests: `apps/server/tests/sources/bikes/`, against the captures in `tests/fixtures/bikes/`.
