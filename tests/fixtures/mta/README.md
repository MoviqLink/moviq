# MTA captures

Taken on 11/11/2026 between 01:00 and 01:07 UTC (10/11/2026, 20:00 to 20:07 in New York), one
request per file, and trimmed on the same day. No feed needed a key, so no URL carries one.

## Timetables (`gtfs_*.zip`)

From `https://rrgtfsfeeds.s3.amazonaws.com/<file>`, downloaded at 01:00 UTC.

| Capture           | Original | Published (`feed_version`) | Kept                                                         |
| ----------------- | -------- | -------------------------- | ------------------------------------------------------------ |
| `gtfs_subway.zip` | 5.6 MB   | `20261028-fall-2026-pick…` | 29 routes, 1,488 stops, 58 of 20,310 trips, 65 of 261 shapes |
| `gtfs_b.zip`      | 17.0 MB  | `20261009`                 | 68 routes, 4,575 stops, 136 of 58,357 trips                  |
| `gtfs_bx.zip`     | 8.4 MB   | `20261009`                 | 46 routes, 1,890 stops, 92 of 41,156 trips                   |
| `gtfs_m.zip`      | 8.3 MB   | `20261009`                 | 41 routes, 1,823 stops, 82 of 37,872 trips                   |
| `gtfs_q.zip`      | 6.0 MB   | `20261009`                 | 40 routes, 1,422 stops, 94 of 31,199 trips, 58 of 187 shapes |
| `gtfs_si.zip`     | 6.4 MB   | `20261009`                 | 58 routes, 1,965 stops, 116 of 16,524 trips                  |
| `gtfs_busco.zip`  | 8.4 MB   | `20261012`                 | 92 routes, 2,758 stops, 184 of 45,424 trips                  |

Trimmed by rows only: `agency`, `feed_info`, `calendar`, `calendar_dates`, `routes` and `stops`
whole; in `trips`, the first two trips of each route, preferring those running on 10/11/2026;
in `stop_times`, the rows of the first three trips kept; `transfers` left out. Entries keep their
order and their dates (31/07/2026 in the subway file, none in the bus files).

Shapes, added on 11/11/2026 from the same files downloaded again at 03:00 UTC (same
`feed_version`, and every table above identical to the first download):

- `gtfs_subway.zip`: the rows of `shapes.txt` of the shapes its kept trips name and of those the
  captured trains run, by the path in their trip id (`109850_A..N55R` runs `A..N55R`; for a path
  without its pattern, such as `L..S`, every shape of that route and direction).
- `gtfs_q.zip`: the trips of the 14 captured buses whose trips are in this file added to `trips`,
  in the order of the original, and the `shapes.txt` rows of every shape the kept trips name.
- The other bus captures carry no `shapes.txt`, as a file without shapes is admitted.

## Live feeds

GTFS Realtime captures were decoded, cut to a few entities and encoded again with
`encodeGtfsRealtime`, header unchanged. NYCT extensions are not part of the schema and drop out.

| Capture                           | Origin                                                               | Header (UTC) | Kept                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| `subway-ace.pb` … `subway-sir.pb` | `api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-…`       | 01:05:03-26  | 6 trips with their trains, plus one trip without stops and one train not yet departed where the feed had them |
| `bus-vehicle-positions.pb`        | `https://gtfsrt.prod.obanyc.com/vehiclePositions`                    | 01:05:19     | First 40 of 2,288 buses                                                                                       |
| `bus-trip-updates.pb`             | `https://gtfsrt.prod.obanyc.com/tripUpdates`                         | 01:05:19     | The 40 trips of those buses, of 3,850                                                                         |
| `alerts.pb`                       | `api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fall-alerts` | 01:02:52     | 20 of 368 alerts: each agency, stops, trips, 8 periods                                                        |

`bus-occupancy.pb`, added on 11/11/2026: from `https://gtfsrt.prod.obanyc.com/vehiclePositions`
at 03:42:02 UTC (header 03:42:00), taken by the research of that night. Unlike the files above it
was not re-encoded, since the schema drops the crowding extension 1006: the bytes of the header
and of 28 of 1,162 whole entities were copied as served, in their order. Kept: the first 20, and
the first bus of each other combination of `occupancy_status` (1, 2, 3, 5 or none) and capacity
(65, 80, 100 or none). 15 of the 28 carry occupancy.

Subway feeds map to captures as `gtfs-ace` → `subway-ace.pb`, `gtfs-bdfm` → `subway-bdfm.pb`,
`gtfs-g`, `gtfs-jz`, `gtfs-nqrw`, `gtfs-l` likewise, `gtfs` → `subway-1234567.pb` and
`gtfs-si` → `subway-sir.pb`.

Stop times and transfers: the index reads `stop_times.txt` too since 11/11/2026, so the 137 rows
kept are the stop times of the three trips that have them; the other trips are counted out by the
engine. `transfers.txt` stays left out: tests that need it add rows to a rebuilt archive.

## Elevators (`elevators.json`)

From `api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fnyct_ene.json` at 01:06:52 UTC: 16 of
184 rows (6 current outages, escalators among them, and 10 announced), unchanged, as a JSON list.
Rows with a field too long for the 120-character line limit of the repository were not picked.

## Stations, equipment and inventory (`subway-stations.json`, `elevator-equipment.json`, `elevator-inventory.json`)

Taken on 11/11/2026, one request each, for step-free routes:

- `subway-stations.json`: the answer of
  `https://data.ny.gov/resource/39hk-dx4f.json?$select=gtfs_stop_id,complex_id,stop_name,ada,ada_northbound,ada_southbound,ada_notes&$order=gtfs_stop_id&$limit=2000`
  at 04:40 UTC, the request of the source, whole: 496 stations (166 accessible, 8 in one
  direction). Without `complex_id` and `ada_notes` its rows are those taken at 04:00 UTC.
- `elevator-equipment.json`: from
  `api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fnyct_ene_equipments.json`, the 15 of
  707 rows whose equipment `elevators.json` names (03:34 UTC), then the 7 of Times Sq-42 St
  (EL229, EL232, EL233) and Bleecker St (EL329 to EL332) from the same file at 04:36 UTC, when
  the first 15 were unchanged; unchanged, in the order of the original. Its long fields stay, as
  captures keep their exact text.
- `elevator-inventory.json`: from `https://data.ny.gov/resource/94fv-bak7.json?$limit=5000` at
  04:36 UTC (759 rows, `Last-Modified` 10/11/2026 11:29 UTC), the rows of the 22 pieces of
  `elevator-equipment.json`, by `equipment_code`, cut to the columns the source asks for, values
  unchanged.
