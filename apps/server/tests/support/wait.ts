/** Polls `check` until it holds, failing the test if it does not within `timeoutMs`. */
export async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`condition not met within ${String(timeoutMs)} ms`);
}
