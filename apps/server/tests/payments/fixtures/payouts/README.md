# Payouts fixtures

PayPal's OpenAPI file for Payouts (`payments_payouts_batch_v1.json` in
[paypal/paypal-rest-api-specifications](https://github.com/paypal/paypal-rest-api-specifications),
commit `90e8041`) has schemas but no examples, so these come from PayPal's Payouts guide,
developer.paypal.com/api/payouts (the redirect of /docs/payouts/standard/integrate-api/), taken on
2026-11-11 and re-indented.

| File                                               | Example in the guide                          |
| -------------------------------------------------- | --------------------------------------------- |
| `payouts-create.json`                              | "Send payouts": `201`, `PENDING`              |
| `payouts-get.json`                                 | "Show payout batch details": `200`, `SUCCESS` |
| `payouts-create-403-sender-email-unconfirmed.json` | "Negative testing": `ERRPYO002` in the note   |

Two changes, both forced: the guide's create answer has a trailing comma after
`sender_batch_header`, removed so it is JSON; and the page's receiver emails are hidden by its
host's email protection (`[email protected]`), so they read `receiver@example.com`. The guide does
not give the status of the negative-testing answer; the test sends it as `403`, the status the
OpenAPI file documents for "Authorization failed due to insufficient permissions".
