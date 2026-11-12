# Sea traffic source tests

`open-waters.test.ts` covers the Open Waters capture: only timed, recent positions, one per MMSI,
the age rules for moving and stopped vessels, positions in the future or at 0,0, the network of
each vessel, refusals and the anonymous request. The capture is in `tests/fixtures/sea/`.
