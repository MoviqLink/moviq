# End-to-end support

- `global-setup.ts`: starts the provider stand-in, the API and the worker, and stops them after.
- `paypal-setup.ts`: the same with payments on, against the PayPal sandbox, for `paypal.spec.ts`.
- `app.ts`: the deployment's URL, and `test` with the browser kept off the internet, or reaching
  only the hosts a journey allows; `confine` does the same for another browser context.
- `journey-steps.ts`: the steps journeys share: planning with Sara, the first verdict, the late
  train.
- `reward-steps.ts`: the traveller's steps of a reward on the way: the watched trip, the tastes
  told to Sara, the craving, the merchant's question, the offer, and the reservation approved in
  PayPal's window.
- `counter-steps.ts`: the merchant's steps at the counter: a section of the panel, a ticket moved,
  a code scanned, a missing line refunded; and the `custom_id` MovIQ gives a refund.
- `provider-server.ts`: answers provider requests with captures, by host, path and query, their
  times moved to the test's clock; relays the hosts it is given.
- `relay.ts`: sends a request on to the real host over HTTPS and returns its answer as it came.
- `paypal-sandbox.ts`: the PayPal variables of `.env`, the hosts the browser may reach, and the
  order as the sandbox records it, with its authorizations, captures and refunds, and a refund
  with its `custom_id`.
- `paypal-window.ts`: the buyer in PayPal's window: sign in and approve, or close it; masked
  screenshots of a failed test, and the controls of each page without their values.
- `ledger.ts`: the payments and events of a journey, read from the run's database.
- `captures.ts`: which capture answers which endpoint, and the journey captured for the tests.
- `clock-shift.ts`: the shift that puts a capture's moment on the anchor, and JSON date-times.
- `timetable-shift.ts`: a static GTFS capture moved by whole days, to the day it is asked on.
- `zip-text.ts`: an archive with the text of some of its files replaced, the rest copied as is.
- `gtfs-shift.ts`: a GTFS Realtime capture with its times moved, and a train held at a station.
- `provider-control.ts`: what the tests ask the stand-in: a new anchor, a held train.
- `tokens.ts`: the operations tokens of the throwaway test deployment.
- `merchants.ts`: the demo merchants open all day in the run's database (a run happens at any
  hour), and the orders with their PayPal holds as MovIQ keeps them: status, amounts, PayPal's
  ids, how many times each hold was captured, what each line was paid, and the refunds of a hold.
