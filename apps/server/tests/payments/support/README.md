# Payment test support

- `fixtures.ts`: reads the official PayPal examples in `tests/fixtures/paypal/`.
- `paypal-server.ts`: PayPal's API on a local port, for the real client and HTTP stack.
- `fake-paypal.ts`: PayPal in memory with its rules (request ids, approval before capture, one
  capture per order), scripted failures and lost answers.
- `payments.ts`: a migrated database, a test catalogue that applies purchases in the caller's
  transaction, and small queries.
- `api.ts`: the payments routes mounted under `/api/payments`, and a device that keeps its
  session cookie.
- `fake-paypal-holds.ts`: PayPal in memory for orders of intent AUTHORIZE: approval before
  authorization, one capture or one void per authorization, refunds (completed or left pending
  and settled later, read back by id, with their `custom_id`), scripted lost answers and lost
  requests.
- `paypal-holds-server.ts`: that PayPal behind PayPal's REST paths on a local port, for API and
  worker processes started with `TEST_PROVIDER_ORIGIN`; a lost answer drops the connection.
- `holds.ts`: a migrated database, that PayPal and a purchase that records what it applies, with
  a hold started or authorized.
