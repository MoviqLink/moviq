# Events module tests

- `merge.test.ts`: one event once by the same venue and start, over the real captures; never by
  name, never when the match is not one to one, never two events of one provider chained.
- `routes.test.ts`: `GET /api/events` with the real reader on a temporary database (`seed.ts`
  admits the captures as the collector does): Ticketmaster missing and said so, a merged concert
  with both listings, no event already over, the filters, the refusals and no sale of any kind.
