# Accessibility captures

`subway-entrances.json`: the whole answer of
`https://data.ny.gov/resource/i9wp-a4ja.json?$select=station_id,gtfs_stop_id,complex_id,stop_name,entrance_type,entry_allowed,exit_allowed,entrance_latitude,entrance_longitude&$order=station_id,entrance_latitude&$limit=5000`,
the request of the source, taken on 11/11/2026 at 04:31:26 UTC with the generic browser identity
and no key: 2,120 entrances. Unchanged; re-indented by Prettier.

The stations and equipment it is joined to are in `tests/fixtures/mta/`.
