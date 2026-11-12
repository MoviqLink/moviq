# Migrations

Numbered SQL files, `NNNN_name.sql`, starting at `0001` with no gaps. They only move forward:
an applied migration is never edited (the start-up refuses a changed checksum), and a change is a
new file.

Each file runs inside a transaction, so it must not contain `BEGIN` or `COMMIT`. Tables are
`STRICT`, instants are UTC text written by `toInstant`, and money is stored in integer minor
units with its currency.

| Migration                    | Adds                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `0001_worker_leases`         | `worker_leases`, the lease of the worker                                                |
| `0002_worker_heartbeats`     | `worker_heartbeats`, the hosting probe                                                  |
| `0003_data_platform`         | Source facts, runs, snapshots, incidents, interests, jobs and the audit log             |
| `0004_ops_sessions`          | Control room sessions (hashed ids)                                                      |
| `0005_travellers`            | Anonymous travellers and their device sessions (hashed ids)                             |
| `0006_payments`              | Payment ledger: operations, allowed transitions, history, refunds, events               |
| `0007_assistant`             | Sara's conversations (the trip draft only) and the daily token budget                   |
| `0008_journeys`              | Plans, watched journeys and their events                                                |
| `0009_recorder`              | The recorder's cursor, gaps and status, and the nightly statistics                      |
| `0010_commerce`              | Demo merchants, needs, offers, holds, orders, tickets, payouts and the protocol         |
| `0011_recorder_gps_measures` | Bus speeds by stretch and the replayed error of `gps-plus`, by day                      |
| `0012_money_owed_back`       | Refunds followed to their end, owed releases, refunds deducted from payouts             |
| `0013_merchant_hours`        | Opening hours by day in the agent's rules, from the single range of `0010`              |
| `0014_merchant_credentials`  | Bind merchant sessions to the current access credential; legacy sessions remain invalid |
| `0015_agent_workspace`       | Persistent agent workspace, jobs, messages and action history                           |
| `0016_tickets`               | Sandbox ticket-demo intents, each linked once to a confirmed payment                    |
| `0017_watch_schedule`        | Indexed fair scheduling of active watches in bounded batches                            |

`0018_virtual_rides` stores session-owned virtual rides, expiring invitations and route validation.

`0019_demo_partner` stores independent hashed sessions for the fictional transport provider.

`0020_ticket_autopay` stores each traveller's switch for the tickets Sara buys and their PayPal
billing agreement (`ticket_autopay`).

`0021_trip_wallet` stores the trip wallet: top-ups, counted once their payment is captured, and
spends, the tickets paid from the balance (`wallet_top_ups`, `wallet_spends`).
