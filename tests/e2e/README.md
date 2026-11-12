# End-to-end journeys

Playwright runs each journey in Chromium against what a deployment runs: the API serving the
built web, and the worker, on a fresh database. Providers are answered by captures of real
responses from `tests/fixtures/` (`support/captures.ts`), through `TEST_PROVIDER_ORIGIN`, which
the configuration only accepts with `APP_ENV=test`. The browser never leaves the machine: every
request to another origin is refused (`support/app.ts`), so the map draws without its tiles.

```sh
npm run build
npm run e2e
```

| File                 | Journey                                                                                                                                                                                                                            | Requirements                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `explore.spec.ts`    | `#/explore` in English and Spanish: counts per mode, modes without a source, filter, card, view                                                                                                                                    | F-J6-09, F-J6-10                                                    |
| `journey.spec.ts`    | Plan with Sara, start the trip, the worker's verdict, payments off; a train held: incident, options, switch                                                                                                                        | F-J1-01, F-J1-12, F-J2-01, F-J2-02, F-J2-04, F-J2-05 (payments off) |
| `operations.spec.ts` | An operator watches the sources, asks for a refresh and finds it in the history                                                                                                                                                    | Control room                                                        |
| `merchant.spec.ts`   | A demo merchant enters, reads the conversation between Sara and its agent, starts a ticket and scans a code (payments off: the order is written as PayPal's confirmation would leave it)                                           | F-J9-01, F-J9-03, F-J9-04, F-J9-05, F-J9-13                         |
| `rewards.spec.ts`    | A craving told to Sara on the trip: the merchant's question, the offer at the server's price, declined, asked again; payments off hold nothing. With the sandbox: held in PayPal, the QR in My orders, cancelled for free (voided) | F-J4-01, F-J4-03, F-J4-04, F-J4-06, F-J4-07, F-J4-09                |
| `paypal.spec.ts`     | The taxi paid in the PayPal sandbox: cancelled in PayPal's window, then approved, charged once and taken                                                                                                                           | Phase 3, step 5 (`npm run e2e:paypal` only)                         |
| `pickup.spec.ts`     | Reserved with the sandbox, QR in My orders; the merchant, in its own browser, readies and scans: charged once; the code again is used; a missing line refunded once                                                                | F-J4-07, F-J9-04, F-J9-05 (`npm run e2e:paypal` only)               |

## The PayPal journey

`rewards.spec.ts` runs in both: its first journey in `npm run e2e` (payments off) and its second,
the hold approved by the sandbox buyer and cancelled, in `npm run e2e:paypal`. The demo merchants
open all day in the run's database (`support/merchants.ts`), so it passes at any hour.

`pickup.spec.ts` follows a reward to the counter, with nothing written into MovIQ's tables but
the demo merchants' opening hours: the hold is approved in PayPal's window, the code is the one
the API gives My orders to draw its QR, and the merchant, in another browser context, enters its
panel, moves the ticket and pastes the code. The ledger then has one capture of the hold and the
order collected, and PayPal's record of the order its authorization captured, with one capture;
scanning the same code again is refused as used and leaves both as they were. Then the merchant
gives back a missing line from Scan: refunded, or in progress if PayPal keeps it pending. The
ledger has that one refund, with PayPal's id, for what the line was paid; PayPal has it with the
same id and amount, and the `custom_id` MovIQ sent, the SHA-256 in hex of its request id. Asking
for the same line again gives nothing more back, in the ledger or in PayPal.

`paypal.spec.ts` and `pickup.spec.ts` use the real PayPal sandbox, so they need the network and
`.env`: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and the sandbox's test buyer,
`PAYPAL_SANDBOX_BUYER_EMAIL` and `PAYPAL_SANDBOX_BUYER_PASSWORD` (an account with a card: its
sandbox balance may not cover a taxi). They run with their own configuration
(`paypal.config.js`): `npm run e2e` never runs `paypal.spec.ts`, and skips `pickup.spec.ts`, as it
does not read `.env`.

```sh
npm run build
npm run e2e:paypal
```

Without those variables nothing starts: the run names the missing ones and skips its tests.

- **Browser:** MovIQ and PayPal's pages, web SDK and assets over HTTPS (`*.paypal.com`,
  `*.paypalobjects.com`, the sandbox included). Everything else is refused, as above.
- **API and worker:** `api-m.sandbox.paypal.com` for real. Their HTTP client still sends every
  request to the stand-in (`TEST_PROVIDER_ORIGIN`), which relays that one host to PayPal over
  HTTPS, as it was sent (`support/relay.ts`); every other provider gets its capture. The
  deployment always runs with `PAYPAL_ENV=sandbox`, whatever `.env` says.
- **The test itself:** reads MovIQ's ledger from the run's database and, as an independent check,
  the order from the sandbox with the app's keys: its authorizations, captures and refunds, and
  a refund by its id with its `custom_id`.

Nothing typed in PayPal's window is kept: tracing, videos and automatic screenshots are off, and a
failed test keeps screenshots with every field and the buyer's email masked, and the controls of
each page by tag, id and label, without their values. The buyer leaves PayPal's window by closing
it on its first page, which offers no other way back.

## Captures on the test's clock

Captures keep the moment they were taken. The stand-in moves every time of a capture by the same
whole number of minutes, so that this moment falls on the test's "now" (the anchor): GTFS
Realtime feeds by their header, Transitous answers by the instant their journey was captured.
Stops, lines, order and gaps stay as the provider gave them, so a plan and the trains of the same
moment still meet. `journey.spec.ts` moves the anchor to its start (`resetProviderClock`) and
types the deadline the capture asked for, moved the same way. GeoSearch answers by the text
searched and Transitous by the query, its date-times compared as they were when captured. A
request with no capture for its path and query gets a 404.

Between two moves the anchor stays, so captures age as a feed that stopped would: a bus position
is two minutes old within a minute or two of the anchor. `explore.spec.ts` moves the anchor to now
once the map has its timetables, and waits for the next reading before it checks that buses are
live.

Timetables move by whole days instead. The MTA ones keep only trips running on 10/11/2026, and
the server refuses a timetable with no trip today, so the stand-in moves their calendars, calendar
exceptions, feed dates and the date of their version, weekdays included, until that day is the New
York date they are asked on (`support/timetable-shift.ts`): a holiday, a Saturday or a Sunday is
that Tuesday again. Stops, trips and stop times stay as captured.

The late train is the one change to a capture: `delayTrain` holds the route at the station where
the ride ends, from the moment the train of the plan is due, in both directions, for 2 minutes:
the captured feed already runs that train 4 minutes behind the plan, so it ends 6 minutes late.
Transitous is replayed as captured, so the alternatives the watch finds do not know of the hold-up.
The worker reads the feed at once through the control room's refresh, instead of at its next turn.
