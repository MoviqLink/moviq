# Event source tests

One file per source of `src/modules/data-platform/sources/events/`, over `tests/fixtures/events/`:
the NYC Parks capture and the Ticketmaster and venue answers written for the tests in their shapes
(`fixtures.ts` reads them and records when each was taken):

- `ticketmaster.test.ts`: the page normalised, the official page out of the click tracker, the
  status in either spelling, every reason to leave an event out, the windows across the change
  of the clocks, the request, the quota, and no request without `TICKETMASTER_API_KEY`;
- `nyc-parks.test.ts`: New York times, the first of several places, the cancellation in the
  title, the categories, the request and every refusal;
- `venues.test.ts`: schema.org events of both venues, the 00:00:01 placeholder, statuses, events
  in a graph or a list, and the page with no event.
