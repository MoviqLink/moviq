# Street captures

Taken on 11/11/2026 between 04:31 and 04:45 UTC (23:31 to 23:45 on 10/11 in New York), one
request each, with the generic browser identity. No key, except the public demonstration key of
api.data.gov (`DEMO_KEY`) for the AFDC API. The times are each answer's `Date`.

| Capture                             | Origin                                                                                                                        | Date (UTC) | Kept                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------- |
| `street-closures-today.json`        | `data.cityofnewyork.us/resource/i6b5-j7bu.json`, closures covering 11/11                                                      | 04:31:25   | 8 of 3,191 rows     |
| `permitted-events-today.json`       | `data.cityofnewyork.us/resource/tvpp-9vvx.json`, events covering 11/11                                                        | 04:32:16   | 8 of 610 events     |
| `street-permits-staten-island.json` | `data.cityofnewyork.us/resource/tqtj-sjs8.json`, Staten Island, in force on 11/11                                             | 04:35:04   | 6 of 4,286 permits  |
| `permit-stipulations.json`          | `data.cityofnewyork.us/resource/gsgx-6efw.json?permitnumber=B022026282B47`                                                    | 04:35:06   | Whole: 11 rows      |
| `parking-meters.json`               | `data.cityofnewyork.us/resource/693u-uax6.json`, all meters                                                                   | 04:36:53   | 12 of 15,598 rows   |
| `parking-signs-tile.json`           | `data.cityofnewyork.us/resource/nfid-uabd.json`, tile 987, 219                                                                | 04:44:36   | Whole: 157 signs    |
| `ev-chargers.json`                  | `data.ny.gov/resource/7rrd-248n.json`, electric, in the area box                                                              | 04:36:57   | 9 of 914 stations   |
| `afdc-new-jersey.json`              | `developer.nlr.gov/api/alt-fuel-stations/v1.json?api_key=DEMO_KEY&fuel_type=ELEC&state=NJ&status=E,T&access=public&limit=all` | 04:34:39   | 6 of 2,217 stations |
| `defibrillators.json`               | `data.cityofnewyork.us/resource/2er2-jqsx.json`, all rows                                                                     | 04:32:41   | 9 of 7,437 rows     |
| `public-restrooms.json`             | `data.cityofnewyork.us/resource/i7jb-7jku.json?$limit=5000`, all rows and columns                                             | 14:45:58   | 22 of 1,100 rows    |

The requests are those of the sources, with the same `$select`, `$where` and `$order`, except:
the date asked for the closures, events and permits is 11/11, the next New York day (the sources
ask the New York day of the request, so the tests read these as at 00:30 on 11/11 in New York);
`street-permits-staten-island.json` also asked `boroughname`; `parking-meters.json` also asked
`x` and `y`, the state-plane feet the projection is tested against; `ev-chargers.json` also asked
`updated_at`. The extra columns are not read.

Cut by whole rows, in their order; re-indented by Prettier. The rows kept: one closure per borough,
a row repeated whole and a longer line; one event of each closure type and one with its side of
the street; permits of each status in force, with a start time, an early end and stipulations;
meters active, inactive, without status, off street, in lower case, one number listed twice the
same and one listed twice with different places; chargers of each borough and two outside the
city; New Jersey chargers in the city area, one temporarily unavailable with a four-digit ZIP
code, and two outside it; defibrillators with and without a place inside or a date.

`public-restrooms.json` was taken apart, at 14:45:58 UTC on 11/11/2026 (09:45 in New York), one
request with the generic browser identity: the whole dataset with every column and no order
(`Last-Modified` of the dataset: 04/11/2026 21:47:41 UTC). The source asks for its columns by
`$select`, ordered by name; the extra columns (`menstrual_friendly`, `location_1` and the computed
regions) are not read. The rows kept: those within 800 m of the stops of the trip in `journey/`
(Parkchester and Grand Central), one of each status not in service, one in service kept for
staff, one place listed twice, and in service: a key needed, a unit "free to use", seasonal and
not accessible, limited access, a changing table in one restroom only, a weekly table with tabs,
and "24 Hours". Licence: NYC Open Data under the City's terms of use
(`https://www.nyc.gov/main/terms-of-use`).

`landmarks.json` is the complete LPC `buis-pvji` response preserved in the v0 local cache.
It has 1,532 rows and includes designated and other records, missing coordinates and duplicates.
The cache does not preserve the HTTP response date, so its modification time is not treated as a
publication or capture time. It is a test fixture only, never a production source.
