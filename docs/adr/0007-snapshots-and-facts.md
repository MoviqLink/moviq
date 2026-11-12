# 0007 · One snapshot per admitted version; states recomputed at read time

**Context.** Real-time feeds change every 30 seconds and carry thousands of vehicles. The free
database plan allows about 10 million written rows a month, and the API and the worker are
separate processes that must agree on what is served.

**Decision.**

- The worker stores each admitted version of a source as one compressed JSON snapshot, keyed by
  a hash of its content. Real-time sources keep one version; timetables keep a few.
- After every run it writes the facts of the source (data time, last attempt, last error,
  failures in a row, Retry-After) in the same fenced transaction as the run and the snapshot.
- Nothing reads the state as stored: the API recomputes it from the facts and the current time,
  so a served copy keeps ageing and an outage shows up without waiting for the next run.
- Normalised data is plain JSON, validated again with each source's `dataSchema` when read back.
- GTFS Realtime is decoded with `protobufjs` and the official schema vendored with its licence,
  rather than a bindings package that declares no licence in its metadata and ships build tools
  as runtime dependencies.

**Consequences.** A real-time source costs about four row writes per update, whatever the number
of vehicles. Reading a source means one small query for its facts and, when the version changed,
one snapshot. Per-vehicle history is not stored; daily aggregates will be.
