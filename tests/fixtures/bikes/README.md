# Bike share captures

Taken on 11/11/2026 at 02:29:27 UTC (21:29 in New York) from Citi Bike's GBFS 2.3 feed, one
request per file, with the generic browser `User-Agent`. No key.

| Capture                              | Origin                                                           | Kept                 |
| ------------------------------------ | ---------------------------------------------------------------- | -------------------- |
| `citi-bike-station-information.json` | `https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json` | 12 of 2,519 stations |
| `citi-bike-station-status.json`      | `https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json`      | The same 12 stations |

Cut by whole rows, in their order, envelope unchanged; re-indented by Prettier. The twelve:
six renting with e-bikes, one empty, two never reported (`last_reported` 86400), one installed
but not renting, one whose per-type counts disagree with its total, and one removed station last
reported on 29/10/2026.
