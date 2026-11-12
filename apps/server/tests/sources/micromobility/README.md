# Micromobility source tests

`fleets.test.ts` covers the Lime, Veo (Bronx and Queens) and Bird captures: kinds, rotating and
stable ids, report times, rows left out, refusals (not JSON, no envelope, a future file, no
vehicle) and the checks against the data served. Captures are in `tests/fixtures/micromobility/`.
