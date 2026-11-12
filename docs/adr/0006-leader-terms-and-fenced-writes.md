# 0006 · Work runs in leader terms with fenced writes

**Context.** Holding a lease is not enough to keep work single: a worker can pause (a long
garbage collection, a frozen host, a slow database) and resume after another worker took over,
still believing it leads. Lease operations that waited for the database lock could also judge
expiry with the time at which they were requested.

**Decision.**

- Lease operations read the clock inside their write transaction, once the lock is held.
- `runAsLeader` starts the work only when the lease is taken, as a **term** with its own abort
  signal. The term ends when a renewal is refused, when the database cannot confirm the lease
  before it would expire (renewals fail until `expiresAt − interval`), when the work ends, or
  when the process stops. The lease is released only by a term that still holds it.
- Every write of leader work goes through `term.fenced()`: a write transaction that first checks
  `worker_leases` for the same holder, the same fencing token and an unexpired lease, then runs
  the work. The check and the writes commit together or not at all.
- Work that fails is logged and ends its term; it runs again in a new term after a pause.

**Consequences.** A stale worker cannot commit a single write, even before it notices the loss.
Clock skew between hosts can make a hand-over happen early, but never lets two terms commit
interleaved writes. Each job takes a `LeaderTerm` and must stop when its signal fires.
