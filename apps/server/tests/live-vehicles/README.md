# Live vehicles tests

`city.ts` loads the captures of `tests/fixtures/` through the real collector into a fresh
database, each at the time it was taken (`liveCity(estimate, start)`, `moveTo`), and serves
`/api/live` from a city the test can build itself (`live`). `feeds.ts` derives variants from the
MTA captures (a bus that moved 125 m in 30 s, a bus on an unknown route, a trip whose last stop
no timetable knows, an A train that has left 181 St). `reader.ts` is a double of the platform's
reader over a capture parsed by its own source, for the captures the coverage checks refuse.

- `live-vehicles.test.ts`: buses and subway trains, exclusions, source states and kinds (static
  or live), the box and the interest.
- `modes.test.ts`: LIRR and Metro-North, PATH, NYC Ferry, aircraft (and adsb.fi standing in),
  ships, the `modes` filter, the sources without timed stops, shuttles and parked vehicles.
- `feeds-unit.test.ts`: bike stations joined to their places and cited without the brand, and the
  usual route of a callsign.
- `warm.test.ts`: the city built every 5 seconds while nobody looks, and the regression it fixes:
  a train seen leaving its station is drawn between stations on the first screen.
- `motion.test.ts`: speed and course between two GPS reports.

`estimation/` checks the estimator piece by piece: `kalman.test.ts` against values computed by
hand; `gps-plus.test.ts` the line, never drawing behind, stopping at a stop and the restarts on an
impossible jump; `run-time.test.ts` the conditioned median, the weighed arrival time, the possible
stoppage and the segment without statistics; `estimator.test.ts` the labels, the measured margin,
the stoppage carried to the position, the published position without a shape and forgetting a
vehicle; `statistics.test.ts` the checks on the recorder's answers; `captures.test.ts` the Queens
buses on their shapes and an A train between 181 St and 190 St. `lines.ts` builds straight test
lines and `statistics.ts` a double of the recorder.

`virtual-bus.test.ts` verifies GPS freshness, source-failure refusal and the eight timed stops
used for virtual boarding against the admitted MTA captures.
