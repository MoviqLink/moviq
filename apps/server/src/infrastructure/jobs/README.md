# Jobs

- `lease.ts`: a named lease in `worker_leases`. Only one holder at a time; an expired lease can
  be taken by another, and each change of holder raises the fencing token.
- `leadership.ts`: `runAsLeader` runs work only while the process holds the lease. Each time the
  lease is taken a **term** starts; its signal fires when the lease is lost, cannot be confirmed
  before it expires, or the process stops. `term.fenced()` commits a write only if the term still
  holds the lease, checked inside the same write transaction
  ([ADR 0006](../../../../../docs/adr/0006-leader-terms-and-fenced-writes.md)).

Every operation reads the clock inside its write transaction, so a call that waited for the lock
judges expiry when it writes. Tested in `tests/lease.test.ts`, `tests/leadership.test.ts` and,
with two real worker processes, in `tests/process.test.ts`.
