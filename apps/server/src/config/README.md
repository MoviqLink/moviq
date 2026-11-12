# Configuration

Turns the environment into a validated `AppConfig` once, at start-up.

- `config.ts`: the schema, the defaults and the rules that combine variables (live payments,
  production). `loadConfig` is pure: it returns the configuration or the list of problems.
- `integrations.ts`: every external service with the variables it needs, resolved to
  `configured`, `missing` or `incomplete`. Credentials never stop the start-up.
- `secret.ts`: the `Secret` wrapper that keeps credentials out of logs and output.

Tested in `tests/config.test.ts`.

`TICKET_DEMO_ENABLED=true` enables the fictional transport demo sessions only when PayPal Sandbox is configured and available. It defaults to false and cannot be used with live PayPal.

`PAYPAL_DEMO_AGREEMENT_ID` is optional and requires `TICKET_DEMO_ENABLED`: a sandbox billing agreement the test buyer approved, to which every demo traveller starts connected, so the assistant pays and the wallet is topped up with no PayPal sign-in. It is refused outside the sandbox.

`PAYPAL_DEMO_BUYER_ENABLED` defaults to false. When explicitly enabled with the ticket demo and sandbox payments, the configured `PAYPAL_SANDBOX_BUYER_EMAIL` and `PAYPAL_SANDBOX_BUYER_PASSWORD` are made available to every demo visitor. Use only a disposable test buyer. Responses are not cached.
