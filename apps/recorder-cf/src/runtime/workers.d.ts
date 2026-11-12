/** The Workers APIs the recorder uses, declared narrowly instead of the whole runtime. */
declare module 'cloudflare:workers' {
  export interface DurableObjectStorage {
    readonly sql: {
      exec(
        query: string,
        ...bindings: (string | number | null | ArrayBuffer)[]
      ): { toArray(): Record<string, unknown>[] };
    };
    getAlarm(): Promise<number | null>;
    setAlarm(at: number): Promise<void>;
  }

  export interface DurableObjectState {
    readonly storage: DurableObjectStorage;
  }

  export abstract class DurableObject<Env> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}

declare module '*.proto' {
  const text: string;
  export default text;
}
