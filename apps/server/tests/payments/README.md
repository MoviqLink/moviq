# Payment tests

No network and no keys: PayPal is either a local HTTP server answering with the official
examples (`tests/fixtures/paypal/`, and `fixtures/payouts/` here), or an in-memory PayPal that
keeps its rules.

| File                          | Covers                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `paypal-client.test.ts`       | Every client call against the official examples, request ids, the token                                |
| `paypal-errors.test.ts`       | PayPal errors as typed errors; webhook verification byte for byte                                      |
| `ledger.test.ts`              | Transitions, versions, one open payment, refunds and events once                                       |
| `payments-api.test.ts`        | Config, server prices, ownership, confirm once, unknown answers, refunds                               |
| `webhooks.test.ts`            | Signatures, events processed once and only when they succeed                                           |
| `reconcile.test.ts`           | Restart between capture and record, lapsed orders, fences, isolation                                   |
| `boundary.test.ts`            | Only the payments module talks to PayPal                                                               |
| `holds.test.ts`               | Holds: authorize, capture once, lost answers, void, unapplied, refunds                                 |
| `hold-compensation.test.ts`   | Owed releases voided until PayPal confirms; refunds followed by their own `custom_id`, never by amount |
| `paypal-presentation.test.ts` | MovIQ's name, locale and itemised reward; Payouts on the guide examples                                |

Requirements: NF-PAY-03 (confirm once), NF-PAY-05 (restart before the local record),
NF-PAY-09 (webhooks), NF-PAY-10 (refunds once per operation), NF-PAY-12 (server prices) and
NF-SEC-07 (nothing internal sent to PayPal). `support/` holds the helpers.
