# On-demand provider tests

One file per provider in `src/modules/data-platform/on-demand/`, through the shared HTTP client
over a stub `fetch` (`support.ts`). Each one checks that:

- the real capture in `tests/fixtures/on-demand/` is accepted, with its provenance;
- what it returns survives `JSON.parse(JSON.stringify(...))` read back through the public
  contract (`legSchema`, `placeSchema`, `flightSchema`, `provenanceSchema`);
- each known failure (HTTP 5xx, 429, a body that is not JSON, an unexpected shape, no result)
  gives its outcome with its code;
- the request is the documented one, with the generic identity.

AeroDataBox is read against an answer for AA 100 written in its documented shape
(`aerodatabox-capture.test.ts`) and the official schema (`aerodatabox.test.ts`; see the fixtures README); `flight-allowance.test.ts` covers
its monthly units, one request a second and the flight cache. `shared.test.ts` covers the polyline, the ids, the daily budget and the failure mapping;
`factory.test.ts` the factory. `transitous-streets.test.ts` covers the walks on the streets: the
request, the four walk captures, the cache, the share per plan, the reserve of the day and the
pause after a failure.
