# Database

- `database.ts`: `openDatabase` and the `Database` interface (`query`, `execute`,
  `transaction`). `locateDatabase` turns `DATABASE_URL` into an absolute file (relative paths
  resolve against the server folder) or keeps a remote URL, and refuses in-memory databases. Writes are serialised inside the process and retried while another process
  holds the lock ([ADR 0005](../../../../../docs/adr/0005-serialised-local-writes.md)).
- `migrations.ts`: reads `NNNN_name.sql` files, applies pending ones in their own transaction,
  and detects edited or unknown migrations.
- `rows.ts`: `parseRow` validates rows with a schema before code uses them.

Tested against real SQLite files in `tests/database.test.ts`, `tests/database-location.test.ts`
and `tests/migrations.test.ts`.
