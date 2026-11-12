import { test as base, type BrowserContext } from '@playwright/test';

/** The deployment under test: the API serving the built web, started by the global setup. */
export function appUrl(path = ''): string {
  const url = process.env['E2E_BASE_URL'];
  if (url === undefined) throw new Error('E2E_BASE_URL is set by the global setup.');
  return `${url}${path}`;
}

/**
 * Keeps a browser context to the deployment under test and to the URLs `reaches` lets through:
 * every other request is refused. Returns the hosts refused, filled in as they are.
 */
export async function confine(
  context: BrowserContext,
  reaches: (url: URL) => boolean,
): Promise<ReadonlySet<string>> {
  const local = new URL(appUrl()).origin;
  const refused = new Set<string>();
  await context.route(
    (url) => url.origin !== local && !reaches(url),
    (route) => {
      refused.add(new URL(route.request().url()).host);
      return route.abort('blockedbyclient');
    },
  );
  return refused;
}

/**
 * Playwright's `test` with the browser confined (`confine`) to the deployment under test and to
 * the URLs `reaches` lets through. A failed test lists in its report the hosts that were refused.
 */
export function browserReaching(reaches: (url: URL) => boolean) {
  return base.extend({
    context: async ({ context }, use, testInfo) => {
      const refused = await confine(context, reaches);
      await use(context);
      if (testInfo.status !== testInfo.expectedStatus && refused.size > 0) {
        await testInfo.attach('refused hosts', { body: [...refused].sort().join('\n') });
      }
    },
  });
}

/**
 * The browser off the internet: only the deployment under test answers. Map tiles, styles and
 * fonts from elsewhere are refused, as the screens must cope.
 */
export const test = browserReaching(() => false);

export { expect } from '@playwright/test';
