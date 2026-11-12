# City operations sources

One definition, `plownyc-status`, exported in `cityOpsSources` from `index.ts`. No key.

PlowNYC is the map of the NYC Department of Sanitation that shows, during a snowfall, how long
ago a plow or a spreader passed each street segment. MovIQ reads the route its map asks when it
opens, `mappingapi/api/highlight/active?now=<milliseconds>` (the `now` defeats a one-year cache):
whether tracking is on (`tracking`), when the streets were last recomputed (every 15 minutes) and
when the next recompute is due. The time of the data is that last recompute. `warm`: every 15
minutes.

- Outside a snowfall the answer is valid and says `tracking: false`; it is not a failure.
- The street segments themselves come only as image tiles and point queries of the map, not as
  data; the history on NYC Open Data (`rmhc-afj9`) names segments by `physical_id`, which needs
  the street centreline to be placed. Neither is read here.

Terms: the map shows the City's disclaimer (data may be inaccurate or incomplete); the Open Data
history declares no licence.

Tests: `apps/server/tests/sources/city-ops/`, against the capture in `tests/fixtures/city-ops/`.
