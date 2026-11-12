# Formats

`gtfs-realtime.ts` decodes GTFS Realtime protobuf feeds with the official schema
(`apps/server/vendor/gtfs-realtime.proto`) and validates the fields MovIQ reads with Zod. Bad input
is reported as `not-protobuf` or `unexpected-shape`, never thrown. `encodeGtfsRealtime` builds
protobuf input for tests from plain objects.
