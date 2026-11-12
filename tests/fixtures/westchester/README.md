# Westchester captures

Taken on 11/11/2026 with the generic browser `User-Agent`, one request per file, without a key.

- `bee-line-positions.pb`: `https://westchester.gmv.com/gtfsrtapi/api/vehiclepositions` at
  03:19:57 UTC. Whole: 35 buses on 17 routes, header 03:19:58.
- `bee-line-gtfs.zip`: `https://westchester-win.gmv.com:8443/repository/gtfs-public/GTFS_GMV_WCDOT.zip`
  at 03:23:18 UTC (4.3 MB). Routes 7 and 42 of 57, with their 459 trips and the 167 stops they use.

The timetable was cut by whole rows: the two routes, their trips, their stop times and the stops
they use; agency and both calendars whole; `shapes.txt` with its header only. The entries were
compressed again with their original dates.
