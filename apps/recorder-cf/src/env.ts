import type { Bucket } from './ports.js';

/** A Durable Object namespace: its objects by name, each answering `fetch`. */
interface Namespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

/** The bindings and variables of `wrangler.toml`, and the secret `TOKEN_LECTURA`. */
export interface Env {
  readonly RECORDER: Namespace;
  readonly REDUCER: Namespace;
  readonly RAW: Bucket;
  readonly TOKEN_LECTURA?: string;
  readonly STOPPED?: string;
  readonly RETENTION_DAYS?: string;
}
