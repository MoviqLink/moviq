import { access, readFile, writeFile } from 'node:fs/promises';

import {
  isAllowedLicense,
  renderNotices,
  shippedPackages,
  VENDORED_FILES,
} from './license-rules.js';

const NOTICES = 'THIRD_PARTY_NOTICES.md';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8')) as Parameters<
  typeof shippedPackages
>[0];
const packages = shippedPackages(lock);
const notices = renderNotices(packages);
const refused = packages.filter((pkg) => !isAllowedLicense(pkg.license));
for (const file of VENDORED_FILES) {
  const present = await access(file.path).then(
    () => true,
    () => false,
  );
  if (!present) console.error(`Vendored file missing: ${file.path}`);
  if (!isAllowedLicense(file.license))
    console.error(`Licence not allowed: ${file.path} (${file.license})`);
  if (!present || !isAllowedLicense(file.license)) process.exitCode = 1;
}

for (const pkg of refused) {
  console.error(
    `Licence not allowed: ${pkg.name}@${pkg.version} (${pkg.license ?? 'none declared'})`,
  );
}

if (process.argv.includes('--write')) {
  await writeFile(NOTICES, notices);
  console.log(`${NOTICES} written: ${String(packages.length)} packages.`);
} else {
  const current = await readFile(NOTICES, 'utf8').catch(() => '');
  if (current !== notices) {
    console.error(`${NOTICES} is out of date. Run npm run notices.`);
    process.exitCode = 1;
  } else {
    console.log(`Licences checked: ${String(packages.length)} production packages.`);
  }
}

if (refused.length > 0) process.exitCode = 1;
