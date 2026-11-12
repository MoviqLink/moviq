# Air traffic captures

Taken on 11/11/2026 between 02:51:52 and 02:52:38 UTC (21:51 to 21:52 in New York), one request
per file, with the generic browser `User-Agent` and no key.

| Capture                  | Origin                                                                                              | Kept                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `adsb-lol-new-york.json` | `https://api.adsb.lol/v2/point/40.7/-73.95/25`                                                      | 9 of 71 aircraft: 5 airborne and 3 on the ground by ADS-B, 1 ADS-R           |
| `adsb-fi-new-york.json`  | Written for the tests in the shape of `https://opendata.adsb.fi/api/v2/lat/40.7/lon/-73.95/dist/25` | 9 invented aircraft: 6 airborne, 3 on the ground, 1 ADS-R                    |
| `adsb-routes.csv.gz`     | `https://vrs-standing-data.adsb.lol/routes.csv.gz` (4.5 MB)                                         | 20 of 628,777 rows: the first 6, 12 through New York, 2 with a 3-letter code |

JSON answers were cut by whole aircraft, in their order, the rest unchanged, and re-indented by
Prettier.

adsb.fi is not captured: "adsb.fi open data is for personal, non-commercial use only. You may not
license, sell, rent, or lease any part of the data or the service." (the Terms of
`https://github.com/adsbfi/opendata`), which this MIT-licensed repository cannot pass on.
`adsb-fi-new-york.json` is written for the tests in its answer shape (`now` in seconds, the list in
`aircraft`): invented addresses (`fa0001` to `fa0009`), registrations and call signs (`TST…`), the
same mix of airborne, parked and ADS-R aircraft as the adsb.lol capture. The routes table was cut by whole rows, header kept, and compressed again with gzip.
