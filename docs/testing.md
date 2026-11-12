# Testing

```sh
npm test          # unit and integration tests (Vitest)
npm run verify    # everything CI runs
```

## Layers

| Layer       | Where                               | What it proves                                                 |
| ----------- | ----------------------------------- | -------------------------------------------------------------- |
| Unit        | `*/tests/*.test.ts`                 | Pure rules: configuration, logging, contracts, tools           |
| Integration | `apps/server/tests/*.test.ts`       | A module against a real SQLite file and real HTTP routing      |
| Process     | `apps/server/tests/process.test.ts` | The real entry points as child processes, two workers included |

## Against the real services

Neither runs in `npm run verify`: both need the network and the keys of `.env`.

```sh
npm run verify:live   # one real request per source and integration (apps/server/tests/live)
npm run e2e:paypal    # the paid taxi, approved by the sandbox buyer in PayPal's window
```

`e2e:paypal` needs `npm run build` first, and `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
`PAYPAL_SANDBOX_BUYER_EMAIL` and `PAYPAL_SANDBOX_BUYER_PASSWORD`; without them it skips and
names the missing ones. Each run signs the buyer in once and pays one sandbox order, so it is
run sparingly (`tests/e2e/README.md`).

## Conventions

- **Real databases.** Integration tests open a real SQLite file in a fresh temporary folder
  (`tests/support/temp-database.ts`). Opening it twice stands in for two processes.
- **Controlled time.** Rules that depend on time take a `Clock`; tests use `manualClock()` and
  move it explicitly instead of waiting.
- **Captured logs.** `memoryLogger()` collects log lines so tests can check what was written and,
  just as important, what was not.
- **Invariants, not lines.** A test states a rule of the product ("a lease has one holder",
  "a configuration error never opens the port"), not an implementation detail.
- **Regressions.** Every fixed defect gets a test that fails without the fix.

## The quality gate

`npm run verify` runs, in order: Prettier check, ESLint with type information (no warnings
allowed), TypeScript for every workspace, tests and tools, tests, build, unused code and
dependencies (knip), licences of production packages, and the delivery check.
