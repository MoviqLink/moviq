# Shuttle source tests

- `passio-airports.test.ts`: the JFK and LaGuardia and the Newark captures, an empty feed and the
  header rules.
- `passio-go.test.ts`: the Passio GO capture (passenger counts, a bus without a counter), buses
  left out, an empty answer written by PHP as `[]`, clock times around midnight, refusals and the
  query of the public map.

Captures are in `tests/fixtures/shuttles/`.
