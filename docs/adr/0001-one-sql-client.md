# 0001 · One SQL client, libSQL, for local and remote

**Context.** Journeys, orders, payments and settlements must survive restarts, and development
must not depend on a network service.

**Decision.** Use `@libsql/client` everywhere. `DATABASE_URL=file:…` opens a local SQLite file;
`libsql://…` opens a remote libSQL server. Code depends on the `Database` interface in
`infrastructure/database`, never on the client directly. Local files run in WAL mode.

**Consequences.** Tests use real SQLite files. Production can move between a remote server and a
file on a volume by changing one variable. SQL stays within what SQLite supports.
