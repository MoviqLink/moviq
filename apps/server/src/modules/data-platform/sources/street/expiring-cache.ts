interface Entry<V> {
  readonly value: V;
  readonly storedAt: number;
}

/**
 * Answers kept for a while by key, the oldest dropped first beyond `capacity`, so a reader asked
 * on demand sends one request per key and period at most.
 */
export class ExpiringCache<V> {
  readonly #entries = new Map<string, Entry<V>>();
  readonly #ttlMs: number;
  readonly #capacity: number;

  constructor(ttlMs: number, capacity: number) {
    this.#ttlMs = ttlMs;
    this.#capacity = capacity;
  }

  get(key: string, now: Date): V | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    if (now.getTime() - entry.storedAt >= this.#ttlMs) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, now: Date): void {
    this.#entries.delete(key);
    this.#entries.set(key, { value, storedAt: now.getTime() });
    while (this.#entries.size > this.#capacity) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }
}
