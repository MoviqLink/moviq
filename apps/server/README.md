# @moviq/server

The MovIQ backend: one codebase, two processes.

- `src/main.ts` starts the **api** (HTTP, Hono on Node).
- `src/worker.ts` starts the **worker** (background work under a lease).
- `migrations/` holds the numbered SQL migrations both processes apply on start.
- `tests/` holds unit, integration and process tests.

```sh
npm run dev -w @moviq/server          # api from source
npm run dev:worker -w @moviq/server   # worker from source
```

Both read `../../.env` when it exists. See [operations](../../docs/operations.md).
