# Commerce tests

No network and no keys: the demo merchants come from the migration, PayPal is in memory
(`../payments/support/fake-paypal-holds.ts`) and the merchant agent is the deterministic one, a
scripted one or a fake language model.

| File                     | Covers                                                                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocol.test.ts`       | The need without personal data, strict messages, each refusal, rules agent                                                                                                                                  |
| `negotiation.test.ts`    | Refused messages, clarifications, recomposed offers, the model agent                                                                                                                                        |
| `flow.test.ts`           | Craving to pickup; bad codes; cancelling; privacy; refunds                                                                                                                                                  |
| `merchant.test.ts`       | Session, "Your agent", requests by alias, tickets, Today, payouts                                                                                                                                           |
| `seed.test.ts`           | Demo merchants, order transitions, when a journey passes a stop, settings                                                                                                                                   |
| `wiring.test.ts`         | Building commerce, the reconciliation and payout jobs, Sara's tools                                                                                                                                         |
| `money.test.ts`          | Lapsed offers refused, pending refunds said so, refunds deducted from pays                                                                                                                                  |
| `adverse.test.ts`        | The mounted app: declined, repeated and concurrent requests, restarts                                                                                                                                       |
| `restart.test.ts`        | API and worker processes on one SQLite file, stopped by signal between payment steps: one charge, one order, one hand-over, the worker finishes what was pending, codes still scan with `ORDER_CODE_SECRET` |
| `merchant-agent.test.ts` | Opening hours saved and followed, the preview, scan refusal codes                                                                                                                                           |
| `merchant-talk.test.ts`  | The talk with the agent: proposals checked, saved only once confirmed                                                                                                                                       |

Requirements: F-J4-01 to F-J4-09, F-J9-01 to F-J9-09, F-J9-13 and F-J9-14 (server side). `support/`
mounts both APIs on a migrated database.
