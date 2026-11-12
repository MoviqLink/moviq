# City source tests

One file per source in `src/modules/data-platform/sources/city/`. Each one checks that:

- the real capture in `tests/fixtures/city/` is accepted with its time of the data and coverage;
- the parsed data survives `JSON.parse(JSON.stringify(...))` read back through `dataSchema`;
- every code of the source's failure catalogue is refused with that code, from a real capture or
  an input built from one, and the catalogue has no code without a test;
- the request is the one documented in the definition.
