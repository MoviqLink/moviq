# Test support

- `temp-database.ts`: a real SQLite file in a fresh temporary folder, opened as many times as a
  test needs (each opening stands in for a process).
- `manual-clock.ts`: a clock that moves only when the test says so.
- `memory-logger.ts`: a logger that keeps its lines for assertions.
- `wait.ts`: `waitFor`, which polls a condition until a deadline.
- `app.ts`: the real application with test tokens.
- `merchant-access.ts`: a public dummy credential for isolated merchant tests, never a deployment key.
- `sources.ts`: `testSource`, a small JSON source for platform tests.
- `leadership.ts`: a migrated database with a work log, and helpers to run leader work.
- `journeys.ts`: places, plan requests, routed trips and a routing engine for journey tests.
- `step-free.ts`: hand-written MTA step-free lists, a reader that serves them in any state, and a
  step-free trip from Times Sq-42 St to 34 St-Herald Sq, whose elevator EL293 may be out.
