# Time

- `clock.ts`: one timer for the page, running only while something shows a live time.
- `instant.ts`: seconds since and until an instant, and the local clock time.
- `duration.ts`: spans in their two largest units, limits and latencies.
- `city.ts`: times and days in New York time, whatever the reader's zone, and whole minutes
  between two instants rounded down, so a margin is never overstated.

Tested in `apps/web/tests/time.test.ts` and `age.test.ts`.
