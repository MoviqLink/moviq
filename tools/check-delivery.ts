import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import { checkContent, checkEnvFiles, checkReadmes, type Problem } from './delivery-rules.js';

/** Files that would be delivered: tracked ones plus new ones that git does not ignore. */
const paths = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  {
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter((path) => path !== '');

const problems: Problem[] = [...checkReadmes(paths), ...checkEnvFiles(paths)];
for (const path of paths) {
  const bytes = await readFile(path).catch(() => undefined);
  if (bytes === undefined || bytes.includes(0)) continue;
  problems.push(...checkContent(path, bytes.toString('utf8')));
}

for (const problem of problems) {
  const where =
    problem.line === undefined ? problem.path : `${problem.path}:${String(problem.line)}`;
  console.error(`${where}  [${problem.rule}] ${problem.detail}`);
}
if (problems.length > 0) {
  console.error(`Delivery check failed: ${String(problems.length)} problem(s).`);
  process.exitCode = 1;
} else {
  console.log(`Delivery check passed: ${String(paths.length)} files.`);
}
