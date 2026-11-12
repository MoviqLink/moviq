# 0002 · `api` and `worker` share one codebase and a lease

**Context.** Watching a journey must not depend on an open browser tab, and two workers must
never run the same job.

**Decision.** Build one server package with two entry points: `main.ts` (HTTP) and `worker.ts`
(background work). The worker holds a named lease in `worker_leases` with an expiry and renews it
well before it ends. An expired lease can be taken by another holder, and every change of holder
increases a fencing token.

**Consequences.** A crashed worker is replaced within one lease period plus one renewal
interval, because the waiting worker only tries again at each interval (about 40 s with the
defaults). Work that must not run twice checks it still holds the lease
([ADR 0006](0006-leader-terms-and-fenced-writes.md)). Hosting needs two processes, or both entry points
side by side.
