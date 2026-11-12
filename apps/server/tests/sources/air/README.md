# Air traffic source tests

- `adsb-lol.test.ts`: the adsb.lol capture and the adsb.fi answer written for the tests (their two
  answer shapes), how each
  aircraft was placed, its dated position, aircraft left out, every refusal, the rate limits and
  the area asked for.
- `adsb-routes.test.ts`: the routes capture, kept only through New York, the minimum check and
  the gzip and column faults.

Captures are in `tests/fixtures/air/`.
