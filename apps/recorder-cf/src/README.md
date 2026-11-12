# Recorder on Cloudflare: source

| File                   | Responsibility                                                              |
| ---------------------- | --------------------------------------------------------------------------- |
| `index.ts`             | The Worker: private routes behind `TOKEN_LECTURA`, the cron that checks     |
| `object.ts`            | The two Durable Objects: the recorder and the nightly reducer               |
| `recorder.ts`          | One alarm: upload, downloads, parts within the CPU budget, state            |
| `intake.ts`            | The downloads that are due, their back-off, and their parts in the queue    |
| `sources.ts`           | What is recorded, how often, in how many parts and at what CPU; what is not |
| `collect.ts`           | One download with the common client, its ETag and its back-off              |
| `process.ts`           | One part: fingerprint, parse, checks, times, extractor, events              |
| `audit.ts`             | Impossible jumps between two reports of one vehicle                         |
| `state.ts`, `store.ts` | What is kept between alarms, as one JSON row                                |
| `buffer.ts`            | Gzip members in memory, one SQLite row every 30 s                           |
| `upload.ts`            | Each hour that ended to R2, 128 KiB per step                                |
| `routes.ts`            | Status, statistics and the daily audit                                      |
| `status.ts`            | The status, without any key                                                 |
| `ports.ts`, `env.ts`   | The SQL, R2 and bindings the code uses                                      |
| `gtfs-rt/`             | Protobuf decoding without generated code, and the split of feeds into parts |
| `nightly/`             | The nightly reduction in steps                                              |
| `runtime/`             | What the bundle uses instead of protobufjs and `node:fs`; Workers types     |
