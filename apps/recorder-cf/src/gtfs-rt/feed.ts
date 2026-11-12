import { isScalar, type FieldSpec, type ProtoRoot, type ScalarType } from './schema.js';
import { WIRE, WireReader } from './wire.js';

/**
 * Decodes protobuf messages from a schema read by `schema.ts`, for Workers, where protobufjs
 * cannot run: it builds its decoders with `Function()`, which Workers refuse. The result is what
 * protobufjs `toObject` gives with `{ longs: Number, defaults: false }`: absent fields and empty
 * repeated fields left out, 64-bit numbers as numbers, unknown fields and extensions skipped, a
 * missing `required` field refused; enums by number, or by name with `enumNames`.
 */
export interface Plain {
  [key: string]: PlainValue;
}
type PlainValue = string | number | boolean | Uint8Array | Plain | PlainValue[];

const SCALAR_WIRE: Readonly<Record<ScalarType, number>> = {
  double: WIRE.fixed64,
  float: WIRE.fixed32,
  int32: WIRE.varint,
  int64: WIRE.varint,
  uint32: WIRE.varint,
  uint64: WIRE.varint,
  sint32: WIRE.varint,
  sint64: WIRE.varint,
  bool: WIRE.varint,
  string: WIRE.bytes,
  bytes: WIRE.bytes,
  fixed32: WIRE.fixed32,
  sfixed32: WIRE.fixed32,
  fixed64: WIRE.fixed64,
  sfixed64: WIRE.fixed64,
};

function readScalar(reader: WireReader, type: ScalarType): string | number | boolean | Uint8Array {
  switch (type) {
    case 'double':
      return reader.double();
    case 'float':
      return reader.float();
    case 'int32':
      return reader.int32();
    case 'int64':
      return reader.int64();
    case 'uint32':
    case 'uint64':
      return reader.varint();
    case 'sint32':
    case 'sint64':
      return reader.zigzag();
    case 'bool':
      return reader.bool();
    case 'string':
      return reader.string();
    case 'bytes':
      return reader.bytesField();
    case 'fixed32':
      return reader.fixed32();
    case 'sfixed32':
      return reader.sfixed32();
    case 'fixed64':
      return reader.fixed64();
    case 'sfixed64':
      return reader.sfixed64();
  }
}

export interface DecodeOptions {
  readonly enumNames: boolean;
}

interface Context {
  readonly root: ProtoRoot;
  readonly options: DecodeOptions;
}

function enumValue(context: Context, type: string, value: number): string | number {
  if (!context.options.enumNames) return value;
  return context.root.enums.get(type)?.get(value) ?? value;
}

/** The values of one occurrence of a field: one, or several when a repeated scalar is packed. */
function readValues(
  context: Context,
  reader: WireReader,
  field: FieldSpec,
  wire: number,
): PlainValue[] {
  if (isScalar(field.type)) {
    const expected = SCALAR_WIRE[field.type];
    if (wire === expected) return [readScalar(reader, field.type)];
    if (wire === WIRE.bytes && field.label === 'repeated' && expected !== WIRE.bytes) {
      const packed = reader.nested();
      const values: PlainValue[] = [];
      while (!packed.done()) values.push(readScalar(packed, field.type));
      return values;
    }
    throw new RangeError(`invalid wire type ${String(wire)} for ${field.name}`);
  }
  if (context.root.enums.has(field.type)) {
    if (wire === WIRE.varint) return [enumValue(context, field.type, reader.int32())];
    if (wire === WIRE.bytes && field.label === 'repeated') {
      const packed = reader.nested();
      const values: PlainValue[] = [];
      while (!packed.done()) values.push(enumValue(context, field.type, packed.int32()));
      return values;
    }
    throw new RangeError(`invalid wire type ${String(wire)} for ${field.name}`);
  }
  if (wire !== WIRE.bytes)
    throw new RangeError(`invalid wire type ${String(wire)} for ${field.name}`);
  return [decodeMessage(context, reader.nested(), field.type)];
}

function decodeMessage(context: Context, reader: WireReader, type: string): Plain {
  const fields = context.root.messages.get(type);
  if (fields === undefined) throw new Error(`no type ${type}`);
  const result: Plain = {};
  while (!reader.done()) {
    const { field: number, wire } = reader.key();
    const field = fields.get(number);
    if (field === undefined) {
      reader.skip(wire);
      continue;
    }
    const values = readValues(context, reader, field, wire);
    if (field.label !== 'repeated') {
      const value = values.at(-1);
      if (value !== undefined) result[field.name] = value;
      continue;
    }
    const list = result[field.name];
    if (Array.isArray(list)) list.push(...values);
    else result[field.name] = values;
  }
  for (const field of fields.values())
    if (field.label === 'required' && !(field.name in result))
      throw new Error(`missing required '${field.name}'`);
  return result;
}

/** Decodes `bytes` as the message `type` of `root`. Throws on input that is not one. */
export function decode(
  root: ProtoRoot,
  type: string,
  bytes: Uint8Array,
  options: DecodeOptions,
): Plain {
  return decodeMessage({ root, options }, new WireReader(bytes), type);
}
