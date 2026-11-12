# Ferry source tests

`ferries.test.ts` covers NYC Ferry positions and predictions (captures joined to the trips of the
NYC Ferry timetable, empty feeds at night, boats without a trip left out, header rules) and both
timetables: NYC Ferry dated by `feed_version`, the Staten Island Ferry by its archive, with its
tables in one folder. `ny-waterway.test.ts` covers NY Waterway: its positions joined to the
trips of its timetable, the timetable dated by `feed_version`, refusals and the requests. `ferry-alerts.test.ts` covers the alerts of both: empty captures served as 0 alerts, the GTFS ids
of what an alert affects joining each timetable (and an unknown id kept as published), header
rules and the requests. Captures are in `tests/fixtures/ferries/`.
