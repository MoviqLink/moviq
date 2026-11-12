# CPU guard captures

One real answer of each live source, gzip-compressed, read by `../cpu-budget.ts` to measure what
one alarm of the recorder does with it on the free plan's 10 ms of CPU. They are captures of the
providers' public feeds, kept byte for byte; see `tests/fixtures/` at the repository root for where
and when each source was captured and under which terms. The exception is
`adsb-fi-new-york.gz`: adsb.fi allows personal, non-commercial use only, so it holds the answer
written for the tests in `tests/fixtures/air/`. The recorder leaves adsb.fi out (it repeats
adsb.lol), so the guard does not measure it.
