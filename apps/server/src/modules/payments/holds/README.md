# Holds

Money held on the traveller's PayPal and taken later: an order of intent `AUTHORIZE`, authorized
when the buyer approves it, captured when the counter scans the pickup code, voided when the
traveller cancels. Recorded in `payment_holds` first, with the same rules as payments: the server
sets every amount, every call carries a stable `PayPal-Request-Id` (`<hold>:create`,
`:authorize`, `:capture`, `:void`, `:refund:<operation>`), and nothing is applied before PayPal
confirms it.

`HoldPurchases` is how a module sells with a hold: `authorized`, `captured` and `voided` run in
the transaction that records PayPal's answer. If `authorized` refuses (the kitchen filled up, the
offer lapsed), nothing is kept and the release of the money is owed from that same write
(`payment_hold_releases`): reconciliation voids the authorization, with the same request id,
until PayPal confirms it, whatever PayPal says meanwhile. Only a voided hold meets it.

A partial refund PayPal has not confirmed (no answer, or `PENDING`) is `unknown` in
`payment_hold_refunds`, never said to be done, and reconciliation follows it apart from the hold,
which is closed. Each refund carries its own `custom_id` (`holdRefundReference`, a SHA-256 of its
request id), which PayPal returns on the refund and in the order. With PayPal's id it is read
back; without it, it is looked for in the order by that `custom_id`, never by its amount, so two
refunds of one amount are never taken for each other. If PayPal lists none, it is asked again
under the same request id, which PayPal keeps 45 days (developer.paypal.com/api/rest/requests/):
a repeat returns the first refund instead of making a second. MovIQ asks again for 44 days from
the first request; after that it never asks again on its own: the refund stays `unknown`, is
still looked for by its `custom_id`, and says in `#/ops/money` that a person must check the
capture in PayPal. A 409 `PREVIOUS_REQUEST_IN_PROGRESS` (PayPal still on the first request) is
an unknown answer, not a refusal. A completed refund is final (trigger). Concurrent steps on one
hold are decided again from the hold as it is now (`decideAgainWhenStale`), so a repeated request
is answered, not failed.

| File                    | Responsibility                                                          |
| ----------------------- | ----------------------------------------------------------------------- |
| `hold-steps.ts`         | Start, authorize, capture and void; what each PayPal failure means      |
| `hold-apply.ts`         | Record PayPal's confirmation and apply the purchase in one transaction  |
| `hold-settle.ts`        | Read the order back and record what PayPal did; never sends again       |
| `hold-reading.ts`       | What an AUTHORIZE order says has happened to the money                  |
| `hold-refunds.ts`       | Partial refunds of a captured hold, each operation once                 |
| `hold-refund-store.ts`  | `payment_hold_refunds`: totals, what is due, PayPal's status recorded   |
| `hold-refund-checks.ts` | A refund PayPal has not confirmed, followed to its end                  |
| `hold-release-store.ts` | `payment_hold_releases`: releases owed for refused purchases            |
| `hold-releases.ts`      | One attempt at an owed release: read back, void, or look again later    |
| `hold-reconcile.ts`     | `reconcileHolds(term, deps)`: holds, owed releases, unconfirmed refunds |
| `hold-ledger.ts`        | `payment_holds` and `payment_hold_history`; optimistic versions         |
| `hold-transitions.ts`   | The allowed status changes, equal to `payment_hold_transitions`         |
| `hold-context.ts`       | What every step needs, outcomes, messages and when to look again        |

An answer that never arrived leaves the hold `unknown` until PayPal's record settles it: a capture
lost on the way is found captured, one PayPal never received puts the hold back to `authorized`.
An order the buyer approved whose confirmation never arrived is authorized by reconciliation.

Tested in `tests/payments/holds.test.ts` and `tests/payments/hold-compensation.test.ts`.
