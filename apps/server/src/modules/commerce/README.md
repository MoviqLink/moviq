# Commerce

Commerce on the way: the traveller asks for something ("ramen", "a coffee"), Sara asks the agent
of each demo merchant on the route, the server validates every offer, and the traveller reserves
with PayPal, collects with a signed code and earns the reward ("Move and earn"). Every merchant
is a demo (`demo: true`, id `demo-…`), seeded by migration `0010_commerce` next to real M60 stops
(stop ids, names and positions from OpenStreetMap, © OpenStreetMap contributors, ODbL); names,
menus and prices are examples. Everything else is real: the journey, the times, PayPal.

## The protocol between agents

One conversation per need and merchant (`commerce_threads`, `commerce_messages`), the same for
both panels. Every message has its schema in `@moviq/contracts` (`protocolMessageSchema`), strict:

1. **need** (Sara): alias, craving, pickup window and only the preferences this menu can touch
   (`need.ts`). Never a name, contact, exact place or journey.
2. **clarification** (merchant agent) and **answer** (Sara, from the tastes or from the traveller).
   Bounded by `COMMERCE_MAX_CLARIFICATIONS`; when they run out the need closes and says so.
3. **offer** (merchant agent), then **check** (server): accepted with its reward, or rejected with
   each reason, and the agent recomposes, up to `COMMERCE_MAX_OFFER_ATTEMPTS`.
4. **recommendation** (Sara): the largest reward, then the shortest detour.
5. **payment** and **order** (server), only after PayPal confirms: authorized, captured, voided,
   refunded.

A message from an agent that does not fit (unknown type, a field more, a price as text) is never
adapted: a **refused-message** records why, and the conversation does not advance on it.

## The reward rule

`offer-check.ts` recomputes the menu price from the menu and passes an offer only if it is at
least `MIN_REWARD_PERCENT` (default 10) cheaper, within the agent's maximum discount and minimum
margin, inside capacity (orders per quarter hour), the opening hours and the trip's window, and
safe: no allergen, disliked ingredient, alcohol or diet break, and only changes the kitchen
allows. The agent never states the menu price and cannot skip the check. "Your agent" cannot set
a maximum discount below the program's minimum. The opening hours are up to three stretches a
day, New York time, saved with the rules under their version (`0013_merchant_hours`).

A refused scan keeps its sentence and adds a stable code (`error.reason`: `not-moviq`, `expired`,
`used`, `no-order`, `other-merchant`, `cancelled`, `payments-off`, `unconfirmed`,
`paypal-unavailable`, `not-charged`), which the panel says in English and Spanish.

## The merchant's agent

`MerchantAgent` (`agent.ts`) returns its message as `unknown`. `model-agent.ts` uses Sara's
`LanguageModel` interface and daily budget, with two tools (`propose_offer`, `ask_clarification`)
and a context without the alias or anything personal. `rules-agent.ts` is the honest deterministic
agent, used without a key and whenever the model gives no usable answer; offers say which composed
them (`composer`). "Your agent" previews what the rules compose now for three example customers,
checked by the server and saved nowhere (`agent-preview.ts`), and, with the model only, talks with
its merchant (`agent-talk.ts`): it answers from its real rules and recent refusals, and a change it
proposes passes the same check as saving and is saved only when the merchant confirms it.

## Money

Reserving opens a PayPal order of intent AUTHORIZE (`payments/holds/`) with MovIQ's name, the
traveller's language and the lines at menu price with the reward as discount. Once the buyer
approves, `confirm` authorizes it and, in the same transaction, the order and its kitchen ticket
are created (`hold-purchases.ts`). The counter scans the signed code (`pickup-code.ts`, HMAC with
`ORDER_CODE_SECRET`, ten minutes, single use) and the authorization is captured; the order is
handed over in the transaction that records the capture. Cancelling before the kitchen starts
voids the authorization; after, it is refused. An offer that expired or whose pickup has passed,
by the server's clock, is refused when reserving and when confirming; if PayPal already holds the
money, the order is not created and the release is owed until PayPal confirms it. A missing line
is refunded once, and said to be refunded only once PayPal confirms it (`pending` and HTTP 202
until then; `refundPending` in the order's payment). Asking again for a line already refunded or
under way is refused with 409 and told apart, and nothing is asked of PayPal or told twice. Payouts (`payouts.ts`) pay each collected
sale once, less `PAYOUT_FEE_PERCENT`; the merchant bears refunds, deducted once from the batch
that pays the sale or from the next ones, and `GET /api/merchant/payouts` shows what is still to
deduct (`refundsToDeduct`).

## Files

| File                    | Responsibility                                                     |
| ----------------------- | ------------------------------------------------------------------ |
| `traveller-routes.ts`   | `/api/commerce`: needs, answers, offers, orders                    |
| `merchant-routes.ts`    | `/api/merchant`: the demo session and the panel                    |
| `merchant-sessions.ts`  | Credential-bound merchant sessions (hashed ids, `HttpOnly` cookie) |
| `merchant-board.ts`     | Today, requests with their conversation, tickets, customers        |
| `needs.ts`              | A need across the merchants on the way; Sara's recommendation      |
| `negotiation.ts`        | The protocol of one conversation, bounded                          |
| `need.ts`               | Sara's need message, with only what matters for the menu           |
| `offer-check.ts`        | The server's check of an offer, and its reward                     |
| `agent.ts`              | The merchant agent's interface                                     |
| `rules-agent.ts`        | The honest deterministic agent                                     |
| `model-agent.ts`        | The agent on the language model, falling back to the rules         |
| `route.ts`              | Merchants next to the stops a journey passes, and when             |
| `reservations.ts`       | Reserve (PayPal order), confirm (authorization), cancel            |
| `hold-purchases.ts`     | What each PayPal confirmation applies: order, pickup, cancel       |
| `pickup.ts`             | The scan that charges, and refunds of missing lines                |
| `pickup-code.ts`        | Signed, expiring, single-use pickup codes                          |
| `payouts.ts`, `jobs.ts` | What is owed, pay now, and the weekly settlement job               |
| `merchants.ts`          | Demo merchants, menus and agent rules                              |
| `conversation.ts`       | Conversations and their messages, validated both ways              |
| `offers-store.ts`       | Needs and validated offers                                         |
| `orders-store.ts`       | Orders, kitchen tickets and their transitions                      |
| `views.ts`              | What the traveller sees                                            |
| `rules-update.ts`       | "Your agent": rules and hours checked against the program          |
| `opening-hours.ts`      | Whether an instant is inside the hours; refusals of bad hours      |
| `agent-preview.ts`      | What the rules compose now for example customers, unsaved          |
| `agent-talk.ts`         | The agent talking with its merchant, on the model                  |
| `context.ts`            | Request contexts and HTTP statuses of hold steps                   |
| `settings.ts`           | `MIN_REWARD_PERCENT` and the other settings                        |
| `setup.ts`              | Building commerce from the configuration                           |
| `sara-tools.ts`         | Sara's `find_rewards` and `reserve_offer`                          |

## Privacy

Merchants see the alias and the preferences in the need message, never the traveller id, a
contact or the journey. A traveller's order answers 403 to anyone else. The model receives no
alias and nothing that `assistant/privacy.ts` finds personal.

Tested in `tests/commerce/` and `tests/payments/` (no network, no keys), and against the sandbox
in `tests/live/paypal-holds.live.test.ts` (`npm run verify:live`).

`merchant-login.ts` validates the private demo access key before opening a session. Without
`MERCHANT_ACCESS_TOKEN` the panel cannot be opened; rotation invalidates old sessions.

`promotions.ts` shows a watched journey's owner the demo menu items featured in Business at
nearby upcoming stops. Prices are menu prices; a requested offer is checked separately.
