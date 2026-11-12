# Ferry captures

Taken on 11/11/2026 between 02:27:47 and 02:28:33 UTC (21:27 to 21:28 in New York), one request
per file, with the generic browser `User-Agent`. No feed needed a key. All files are whole.

| Capture                     | Origin                                                                                 | Taken (UTC) | Content                                      |
| --------------------------- | -------------------------------------------------------------------------------------- | ----------- | -------------------------------------------- |
| `nyc-ferry-trip-updates.pb` | `https://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/tripupdate`      | 02:27:47    | 4 trips, header 02:27:44                     |
| `nyc-ferry-positions.pb`    | `https://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/vehicleposition` | 02:27:51    | 4 boats, header 02:27:49                     |
| `nyc-ferry-gtfs.zip`        | `https://nycferry.connexionz.net/rtt/public/resource/gtfs.zip` (31 KB)                 | 02:27:54    | `feed_version` 20261108, 7 routes, 50 stops  |
| `siferry-gtfs.zip`          | `https://www.nyc.gov/html/dot/downloads/misc/siferry-gtfs.zip` (9.6 KB)                | 02:28:33    | `siferry-gtfs_2026.1/`, 1 route, 2 terminals |

Alerts, taken on 11/11/2026 at 03:59:04 (NYC Ferry) and 03:59:06 UTC (NY Waterway) by the
research of that night, both whole: `nyc-ferry-alerts.pb` and `ny-waterway-alerts.pb`, from
`https://<host>/rtt/public/utility/gtfsrealtime.aspx/alert`. Each is the 15-byte header alone
(GTFS Realtime 2.0, `FULL_DATASET`, 03:58:00): no alert that night.

NY Waterway, taken the same day with the same identity, one request per file, both whole:

- `ny-waterway-positions.pb`:
  `https://nywaterway.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/vehicleposition` at
  03:20:08 UTC; 2 boats (`Hudson`, `York`), header 03:19:59.
- `ny-waterway-gtfs.zip`: `https://nywaterway.connexionz.net/rtt/public/resource/gtfs.zip` at
  03:23:30 UTC (32 KB); `feed_version` 20261110, 14 routes, 15 piers.
