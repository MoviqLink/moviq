# GTFS Realtime in the Worker

`schema.ts` reads proto2 schemas (the vendored `gtfs-realtime.proto` and the short ones sources
declare), `feed.ts` decodes messages from them as protobufjs `toObject` does, `wire.ts` reads the
wire format, and `split.ts` cuts a feed into parts by entity id or trip id, each a valid feed.
Tested in `tests/gtfs-rt.test.ts` against protobufjs on every capture of `tests/fixtures/`.
