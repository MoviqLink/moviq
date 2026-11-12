import proto from '../../../server/vendor/gtfs-realtime.proto';

/**
 * Stands in for `node:fs` inside the Worker bundle (`[alias]` in `wrangler.toml`). The only file
 * the bundled modules read is the vendored GTFS Realtime schema, bundled as text.
 */
export function readFileSync(path: string): string {
  if (path.endsWith('/gtfs-realtime.proto')) return proto;
  throw new Error(`ENOENT: ${path} is not bundled with the Worker.`);
}
