# Operations

| File                   | Responsibility                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `health.ts`            | `/healthz` (alive) and `/readyz` (a real database read within 2 s, migrations applied)                                   |
| `heartbeat.ts`         | The hosting probe: a fenced heartbeat every interval while the worker leads                                              |
| `ops-auth.ts`          | Control room sessions in an `HttpOnly`, `SameSite=Strict` cookie, roles, same-origin check for actions, login rate limit |
| `ops-routes.ts`        | The control room API under `/api/ops`                                                                                    |
| `jobs.ts`              | Work asked for by people (manual refreshes), carried out by the worker                                                   |
| `audit.ts`             | Every sensitive action with actor, target and reason, in the same transaction                                            |
| `worker-status.ts`     | Lease holder, heartbeats, gaps, leader changes and latency over 24 h                                                     |
| `money-in-doubt.ts`    | `GET /api/ops/money`: money not settled with PayPal, its totals and the escalation thresholds                            |
| `merchant-balances.ts` | Refunds each merchant still owes from sales already paid out, and since when                                             |
| `safe-detail.ts`       | An error line without card numbers, email addresses or secrets, of bounded length                                        |

## Money in doubt

`GET /api/ops/money` lists every obligation reconciliation is still retrying: a release owed for a
refused purchase, a refund PayPal has not confirmed, a payment or hold whose answer never arrived
(capture, authorization, void or refund; an order still being opened moves no money), a payout
batch PayPal has not resolved, and refunds a merchant owes from sales already paid out. Each comes
with its amount, since when, looks, last error (cleaned by `safeDetail`) and next look.

One is **escalated** after six failed looks in a row (an error recorded each time: reconciliation
starts at 30 s and doubles, so six span about half an hour, while PayPal answers in seconds), or
when open longer than its kind allows: releases and payments 1 h (a traveller's money is in the
air), refunds and payout batches 24 h (PayPal may keep them pending on its side), merchant
balances 14 days (two weekly payouts). The thresholds live in `MONEY_THRESHOLDS` and travel in the
answer. It is a notice for the team: it changes nothing a traveller or a merchant sees, and
reconciliation keeps retrying.

Tested in `tests/health.test.ts`, `tests/heartbeat.test.ts`, `tests/ops-api.test.ts` and
`tests/ops-money.test.ts`.
