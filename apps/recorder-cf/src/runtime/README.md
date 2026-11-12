# Runtime

`protobufjs.ts` and `node-fs.ts` replace protobufjs and `node:fs` inside the Worker bundle
(`[alias]` in `wrangler.toml`): protobufjs builds decoders with `Function()`, which Workers
refuse, and the only file read is the vendored GTFS Realtime schema, bundled as text.
`workers.d.ts` declares the few Workers APIs the recorder uses.
