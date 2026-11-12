# 0005 · Writes are serialised per process and retried while another holds the lock

**Context.** With a local SQLite file, the libSQL client waits for a lock by blocking the event
loop, so two writes from the same process can block each other. And a connection that receives
`SQLITE_BUSY` keeps the failed statement active: SQLite then refuses to commit on it ("SQL
statements in progress").

**Decision.** `Database` runs one write or transaction at a time inside a process. When another
process holds the lock, it retries with a short, growing, randomised delay without blocking the
event loop, up to a deadline (5 s by default), and then fails with `DatabaseBusyError`. A local
connection that got `SQLITE_BUSY` is replaced before the retry. Reads run directly.

**Consequences.** Write throughput per process is that of one connection, which suits SQLite.
Regression tests cover concurrent migrations from two connections and commits after a wait.
