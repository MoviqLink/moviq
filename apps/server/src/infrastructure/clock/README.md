# Clock

`Clock` is the only way code asks for the current time. Production uses `systemClock`; tests pass
a manual clock and move it explicitly, so time rules (lease expiry, freshness) are exact.

`new-york.ts` is the only place that converts between instants and New York dates and times:
zone-less local times, wall-clock fields and GTFS service dates, across daylight-saving changes.

`pause.ts` waits for a while or until a signal aborts, and never rejects, so loops that stop on a
signal stay simple.
