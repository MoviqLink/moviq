const REDACTED = '[redacted]';

/**
 * A credential that cannot leak by accident: printing, logging or serialising it shows
 * `[redacted]`. Code that needs the value calls `reveal()` at the point of use.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return REDACTED;
  }
}
