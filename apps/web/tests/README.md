# Web tests

Unit tests for the logic behind the screens, run by Vitest in Node from the repository root
(`npx vitest run apps/web/tests`). They need no browser:

- `client.test.ts`: the API client validates every answer, translates errors and never keeps an
  answer to a cancelled or superseded request.
- `ops-api.test.ts`: the control room endpoints, their paths, bodies and the signed-out session.
- `ops-money.test.ts`: money in doubt: its address, its contract, the totals and the grid, and
  the empty state.
- `age.test.ts`, `severity.test.ts`, `time.test.ts`: the live age, the order by severity and how
  times are written.
- `i18n.test.ts`: English and Spanish carry the same keys.
- `routes.test.ts`: every control room address opens its screen.
- `fixtures.test.ts`: the fixtures in `fixtures/` match the contracts.
- `app-routes.test.ts`: `#/` plans with Sara, `#/trip/<id>` opens a trip, `#/ops` the control room.
- `lazy-screens.test.ts`: only the home page is in the first load; every other screen comes through
  `React.lazy`.
- `conversation.test.ts`: the conversation with Sara and its store (conversation id, language,
  real retry, an answer after a reset is dropped).
- `journey-model.test.ts`: recommended first, where each time comes from, margins from the
  server's projection (or the plan without one) and the timeline.
- `live-feed.test.ts`: the live connection says since when it is lost, retries with a growing wait
  and reconnects at once when asked; events outside the contract are refused.
- `payment-flow.test.ts`: with a double of PayPal's SDK, paid only when the server says
  `captured`; one order however many presses; nothing confirmed on cancel or error; an
  unconfirmed payment asked about again three times, spaced out, and no second payment meanwhile.
- `map-geometry.test.ts`: the route lines, the framing, the stops and the drawing once.
- `map-style.test.ts`: the shared base map writes names, never road references or shields.
- `trip-api.test.ts`: taking a free alternative and asking for a payment, with their paths.
- `rewards.test.ts`: the offers (recommended first), a merchant's question in Spanish, why there
  is no offer, free cancellation, the alias and tastes kept, the PayPal hold with a double of the
  SDK (one order, reserved only with the server's order, refusals with the server's words) and the
  QR's structure. `rewards-views.test.ts`: an offer row and its detail, a question, an order with
  its QR, what was charged and a refund in progress, rendered in Spanish.
- `traveller-i18n.test.ts`, `journey-fixtures.test.ts`: the traveller's texts and fixtures.
- `restrooms.test.ts`: "Restroom on the way": the next stops asked, step-free only when the trip
  is, what was found by stop, the published hours on one line; the public restrooms layer of
  Explore, off at first and named in both languages.
- `step-free.test.ts`: the step-free sentence of a trip, its words in both languages, and a
  journey kept before the check still read.
- `walks.test.ts`: walks on the streets drawn along their path and estimated ones dotted, each
  row saying how it is known, provisional trips, and no step-free trip called clear while a walk
  was not walked with a wheelchair.
- `merchant/`: the merchant panel: the conversation between Sara and the agent as steps, the
  counter, customers' tags, the rules of "Your agent", problems, the API with its `PUT`s, the
  views and the words in both languages.
