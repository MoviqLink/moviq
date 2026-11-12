import { readFile, writeFile } from 'node:fs/promises';

import { sourceCatalog } from '../apps/server/src/modules/data-platform/catalog.js';
import { renderDataSources } from './data-sources-doc.js';

const DOC = 'docs/data-sources.md';
const expected = renderDataSources(sourceCatalog);

if (process.argv.includes('--write')) {
  await writeFile(DOC, expected);
  console.log(`${DOC} written: ${String(sourceCatalog.length)} sources.`);
} else {
  const current = await readFile(DOC, 'utf8').catch(() => '');
  if (current === expected) {
    console.log(`Data sources documented: ${String(sourceCatalog.length)}.`);
  } else {
    console.error(`${DOC} is out of date. Run npm run docs:sources.`);
    process.exitCode = 1;
  }
}
