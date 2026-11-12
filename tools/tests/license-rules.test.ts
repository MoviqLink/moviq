import { describe, expect, it } from 'vitest';

import { isAllowedLicense, renderNotices, shippedPackages } from '../license-rules.js';

describe('isAllowedLicense', () => {
  it('accepts permissive licences and SPDX expressions that can be met with them', () => {
    expect(isAllowedLicense('MIT')).toBe(true);
    expect(isAllowedLicense('(MIT OR GPL-3.0-only)')).toBe(true);
    expect(isAllowedLicense('Apache-2.0 AND BSD-3-Clause')).toBe(true);
  });

  it('respects parentheses and AND before OR (regression)', () => {
    expect(isAllowedLicense('(MIT OR GPL-3.0-only) AND GPL-2.0-only')).toBe(false);
    expect(isAllowedLicense('MIT OR GPL-3.0-only AND GPL-2.0-only')).toBe(true);
    expect(isAllowedLicense('(MIT AND ISC) OR GPL-2.0-only')).toBe(true);
    expect(isAllowedLicense('(MIT OR (ISC AND GPL-2.0-only))')).toBe(true);
    expect(isAllowedLicense('MIT AND (GPL-2.0-only OR LGPL-3.0-only)')).toBe(false);
  });

  it('accepts permissive licence exceptions and refuses malformed expressions (regression)', () => {
    expect(isAllowedLicense('Apache-2.0 WITH LLVM-exception')).toBe(true);
    expect(isAllowedLicense('GPL-2.0-only WITH Classpath-exception-2.0')).toBe(false);
    expect(isAllowedLicense('(MIT')).toBe(false);
    expect(isAllowedLicense('MIT OR')).toBe(false);
  });

  it('refuses copyleft, unknown and missing licences', () => {
    expect(isAllowedLicense('GPL-3.0-only')).toBe(false);
    expect(isAllowedLicense('MIT AND GPL-3.0-only')).toBe(false);
    expect(isAllowedLicense('SEE LICENSE IN LICENSE.txt')).toBe(false);
    expect(isAllowedLicense(undefined)).toBe(false);
  });
});

describe('shippedPackages', () => {
  it('keeps production packages, optional ones installed for production included (regression)', () => {
    const packages = shippedPackages({
      packages: {
        '': {},
        'node_modules/zod': { version: '4.0.0', license: 'MIT' },
        'node_modules/@libsql/linux-x64-gnu': { version: '0.5.0', license: 'MIT' },
        'node_modules/vitest': { version: '5.0.0', license: 'MIT', dev: true },
        'node_modules/fsevents': { version: '2.0.0', license: 'MIT', devOptional: true },
        'node_modules/@moviq/server': { link: true },
        'node_modules/a/node_modules/zod': { version: '3.0.0', license: 'MIT' },
      },
    });
    expect(packages.map((pkg) => `${pkg.name}@${pkg.version}`)).toEqual([
      '@libsql/linux-x64-gnu@0.5.0',
      'fsevents@2.0.0',
      'zod@3.0.0',
      'zod@4.0.0',
    ]);
  });
});

describe('renderNotices', () => {
  it('lists every package with its version and licence, and the vendored files', () => {
    const text = renderNotices(
      [{ name: 'zod', version: '4.0.0', license: 'MIT' }],
      [{ path: 'vendor/schema.proto', origin: 'https://example.com', license: 'Apache-2.0' }],
    );
    expect(text).toContain('| zod | 4.0.0 | MIT |');
    expect(text).toContain('| `vendor/schema.proto` | https://example.com | Apache-2.0 |');
    expect(text.endsWith('\n')).toBe(true);
  });
});
