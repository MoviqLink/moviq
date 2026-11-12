import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SOURCE = fileURLToPath(new URL('../../src/', import.meta.url));

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('the PayPal boundary (F-J17-13)', () => {
  it('only the payments module talks to PayPal: every charge has its operation and its ledger', () => {
    const outside = sourceFiles(SOURCE)
      .map((path) => relative(SOURCE, path))
      .filter((path) => !path.startsWith(join('modules', 'payments')))
      .filter((path) =>
        /payments\/paypal\/|api-m\.(sandbox\.)?paypal\.com/.test(
          readFileSync(join(SOURCE, path), 'utf8'),
        ),
      );
    expect(outside).toEqual([]);
  });
});
