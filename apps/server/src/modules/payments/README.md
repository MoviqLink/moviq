# Payments

Everything paid in MovIQ is paid with PayPal (Orders v2, intent `CAPTURE`), recorded in MovIQ's
own ledger first. The server sets every amount, every call that moves money carries a stable
`PayPal-Request-Id`, and nothing is applied before PayPal confirms the money.

## How a payment moves

1. `POST /orders`: the module that owns the purchase prices it (`PurchaseCatalog.quote`); the
   client sends only the purpose. The payment is written `unknown` (PayPal has not answered),
   then the PayPal order is opened with request id `<payment>:create`. A repeated request finds
   the open payment of that traveller and purchase instead of opening another order.
2. The buyer approves it in the PayPal window (JavaScript SDK v6, in the web).
3. `POST /orders/:id/confirm`: the price is checked again, the payment is marked `unknown`
   (capture sent) and captured with `<payment>:capture`. When PayPal confirms the capture, the
   payment becomes `captured` and `PurchaseCatalog.fulfil` runs **in the same transaction**. If
   the purchase cannot be applied, nothing of it is kept and the capture is refunded in full.
4. Webhooks and reconciliation read the order back from PayPal and finish whatever was left:
   a capture whose answer was lost, an order approved but never confirmed, an order that lapsed.

An answer that never arrived (time-out, network error, PayPal 5xx) leaves the payment `unknown`,
never paid and never failed, until PayPal's own record settles it. The allowed status changes
are listed in `transitions.ts` and in the database, whose trigger refuses any other.

## Files

| File                  | Responsibility                                                                       |
| --------------------- | ------------------------------------------------------------------------------------ |
| `catalog.ts`          | `PurchaseCatalog`, implemented by the module that owns each purchase                 |
| `routes.ts`           | `paymentsRoutes(deps)`: `/config`, `/orders`, `/orders/:id`, `/confirm`, `/webhooks` |
| `service.ts`          | Starting and confirming a payment for its traveller                                  |
| `settlement.ts`       | Capturing, and reading an order back to record or finish what it shows               |
| `steps.ts`            | Opening the PayPal order, refunds and their bookkeeping                              |
| `order-reading.ts`    | What a PayPal order says has happened to the money                                   |
| `context.ts`          | What every step needs, its outcome, messages and when to look again                  |
| `ledger.ts`           | `payment_operations`, `payment_history`, `payment_refunds`; optimistic versions      |
| `events.ts`           | `provider_events`: each PayPal notification processed once                           |
| `transitions.ts`      | The allowed status changes                                                           |
| `webhooks.ts`         | Signature check with PayPal, then the order read back                                |
| `reconcile.ts`        | `reconcilePayments(term, deps)`, the worker job, with fenced writes                  |
| `open-obligations.ts` | Read only: releases, refunds, payments, holds and batches PayPal has not settled     |
| `setup.ts`            | Whether payments are available, from `PAYPAL_*`, and the PayPal client               |
| `paypal/`             | The PayPal REST client behind the `PayPalGateway` interface                          |
| `holds/`              | Money held (intent `AUTHORIZE`): authorize, capture at pickup, void, partial refunds |
| `payouts/`            | PayPal Payouts to merchants, each sale paid once                                     |

## Privacy

PayPal receives the amount, the catalogue's description and the payment id as `reference_id`:
no journey, traveller or merchant id, and no `invoice_id`. The only `custom_id` is that of a
partial refund of a hold: a SHA-256 of its request id, opaque, so the refund is matched to its
own operation. The payer's name and email that PayPal returns are dropped by the response
schemas and never stored.

## Without keys

Without `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` the server starts, `GET /config` answers
`{ available: false, reason }` naming the missing variables, creating and confirming answer 409,
and reconciliation is off. Without `PAYPAL_WEBHOOK_ID`, `/webhooks` answers 404 and
reconciliation alone keeps payments up to date.

Tested in `tests/payments/` (no network, no keys) and `tests/live/paypal.live.test.ts`
(the real sandbox).
