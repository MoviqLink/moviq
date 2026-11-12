import { decode, type Plain } from '../gtfs-rt/feed.js';
import { parseProto, type ProtoRoot } from '../gtfs-rt/schema.js';

/**
 * Stands in for protobufjs inside the Worker bundle (`[alias]` in `wrangler.toml`), with the
 * part of its interface the sources use: `parse(text, { keepCase: true })`, then `decode` and
 * `toObject` of a type. Workers refuse the `Function()` protobufjs builds its decoders with.
 * `decode` keeps the bytes and `toObject` decodes them with its options, so both run inside the
 * same `try` of their callers, as they do. Encoding exists only for tests, in Node.
 */
interface Message {
  readonly bytes: Uint8Array;
}

interface ObjectOptions {
  readonly enums?: unknown;
  readonly longs?: unknown;
  readonly defaults?: boolean;
}

function typeOf(root: ProtoRoot, name: string) {
  if (!root.messages.has(name)) throw new Error(`no such type: ${name}`);
  return {
    decode: (bytes: Uint8Array): Message => ({ bytes }),
    toObject(message: Message, options: ObjectOptions = {}): Plain {
      if (options.defaults === true) throw new Error('Defaults are not filled in the Worker.');
      return decode(root, name, message.bytes, { enumNames: options.enums === String });
    },
    encode(): never {
      throw new Error('Encoding protobuf is not available in the Worker.');
    },
    fromObject(): never {
      throw new Error('Encoding protobuf is not available in the Worker.');
    },
  };
}

function parse(source: string, options: { readonly keepCase?: boolean } = {}) {
  if (options.keepCase !== true) throw new Error('Only keepCase: true is available in the Worker.');
  const root = parseProto(source);
  return { root: { lookupType: (name: string) => typeOf(root, name) } };
}

export default { parse };
