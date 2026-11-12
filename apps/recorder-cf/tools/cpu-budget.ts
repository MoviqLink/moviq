/**
 * The CPU guard of the recorder (the free plan gives 10 ms of CPU to each alarm). It runs, on
 * real answers captured once (`fixtures-cpu/`), what one alarm does with each part of each
 * source: the fingerprint, the source's parse and checks, its extractor with the schema, the
 * lines and their gzip member; and the split of the feeds that have parts, the 30 s buffer row,
 * the upload of an hour and one step of the nightly reduction. As in Workers, protobufjs is
 * replaced by `src/gtfs-rt` and Zod runs without JIT. Each case is measured five times after a
 * first run (the first is reported, not judged: a fresh isolate is rare) and its median must stay
 * within the cost the source predicts and under 10 ms; the worst of the five is reported. Node
 * is not workerd: the figures compare and guard, they are not Cloudflare's own.
 *
 * Run with `npm run cpu-budget -w @moviq/recorder-cf` (Node with `--single-threaded`, so garbage
 * collection and compilation are counted in the same thread, as in Workers). Exit code 1 on a
 * failure, with the table.
 */
import { registerHooks } from 'node:module';

const SHIM = new URL('../src/runtime/protobufjs.ts', import.meta.url).href;
registerHooks({
  resolve: (specifier, context, next) =>
    next(specifier === 'protobufjs' ? SHIM : specifier, context),
});

const { z } = await import('zod');
z.config({ jitless: true });
const { measureAll } = await import('./cpu-cases.js');
const rows = await measureAll();
let failed = false;
for (const row of rows) {
  const over =
    row.informative !== true &&
    (row.median > row.budget || (row.count !== true && row.median > 10));
  if (over) failed = true;
  const mark = row.informative === true ? 'info ' : over ? 'OVER ' : 'ok   ';
  process.stdout.write(
    `${mark}${row.name.padEnd(44)} first ${row.first.toFixed(1).padStart(6)}  median ` +
      `${row.median.toFixed(1).padStart(5)}  worst ${row.worst.toFixed(1).padStart(5)}  budget ` +
      `${row.budget.toFixed(1).padStart(5)} ms  ${row.note}\n`,
  );
}
process.stdout.write(failed ? 'CPU BUDGET EXCEEDED\n' : 'CPU BUDGET OK\n');
process.exitCode = failed ? 1 : 0;
