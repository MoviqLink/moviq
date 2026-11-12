/**
 * Reads the proto2 schemas MovIQ decodes in the Worker: the vendored GTFS Realtime schema and
 * the short schemas sources declare for fields it leaves out (Bus Time occupancy). It knows
 * messages, nested messages, enums and fields with `optional`, `required` or `repeated`, and
 * skips `syntax`, `package`, `option`, `extensions`, `reserved` and field options.
 */
export type ScalarType =
  | 'double'
  | 'float'
  | 'int32'
  | 'int64'
  | 'uint32'
  | 'uint64'
  | 'sint32'
  | 'sint64'
  | 'bool'
  | 'string'
  | 'bytes'
  | 'fixed32'
  | 'sfixed32'
  | 'fixed64'
  | 'sfixed64';

const SCALARS: ReadonlySet<string> = new Set<ScalarType>([
  'double',
  'float',
  'int32',
  'int64',
  'uint32',
  'uint64',
  'sint32',
  'sint64',
  'bool',
  'string',
  'bytes',
  'fixed32',
  'sfixed32',
  'fixed64',
  'sfixed64',
]);

export interface FieldSpec {
  readonly name: string;
  readonly number: number;
  readonly label: 'optional' | 'required' | 'repeated';
  /** A scalar, or the full name of a message or enum once resolved. */
  readonly type: string;
}

export interface ProtoRoot {
  readonly messages: ReadonlyMap<string, ReadonlyMap<number, FieldSpec>>;
  readonly enums: ReadonlyMap<string, ReadonlyMap<number, string>>;
}

export const isScalar = (type: string): type is ScalarType => SCALARS.has(type);

function tokens(text: string): string[] {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  return clean.match(/"(?:[^"\\]|\\.)*"|[A-Za-z_][\w.]*|-?\d+|[{}[\]=;<>,()]/g) ?? [];
}

interface Pending {
  readonly scope: string;
  readonly field: FieldSpec;
  readonly message: string;
}

/** Parses a schema; names resolve as protobuf resolves them, from the innermost scope out. */
export function parseProto(text: string): ProtoRoot {
  const list = tokens(text);
  const messages = new Map<string, Map<number, FieldSpec>>();
  const enums = new Map<string, Map<number, string>>();
  const pending: Pending[] = [];
  let position = 0;
  let packageName = '';
  const next = (): string => list[position++] ?? '';
  const skipStatement = () => {
    let depth = 0;
    for (;;) {
      const token = next();
      if (token === '') return;
      if (token === '[' || token === '(') depth += 1;
      if (token === ']' || token === ')') depth -= 1;
      if (token === ';' && depth === 0) return;
    }
  };
  const readEnum = (fullName: string) => {
    const values = new Map<number, string>();
    enums.set(fullName, values);
    next(); // {
    for (let token = next(); token !== '}' && token !== ''; token = next()) {
      if (token === 'option' || token === 'reserved') {
        skipStatement();
        continue;
      }
      next(); // =
      const value = Number(next());
      if (!values.has(value)) values.set(value, token);
      skipStatement();
    }
  };
  const readMessage = (fullName: string) => {
    const fields = new Map<number, FieldSpec>();
    messages.set(fullName, fields);
    next(); // {
    for (let token = next(); token !== '}' && token !== ''; token = next()) {
      if (token === 'message') readMessage(`${fullName}.${next()}`);
      else if (token === 'enum') readEnum(`${fullName}.${next()}`);
      else if (token === 'option' || token === 'extensions' || token === 'reserved')
        skipStatement();
      else {
        const label: FieldSpec['label'] =
          token === 'required' || token === 'repeated' ? token : 'optional';
        const labelled = label !== 'optional' || token === 'optional';
        const type = labelled ? next() : token;
        const name = next();
        next(); // =
        const field: FieldSpec = { name, number: Number(next()), label, type };
        fields.set(field.number, field);
        if (!isScalar(type)) pending.push({ scope: fullName, field, message: fullName });
        skipStatement();
      }
    }
  };
  while (position < list.length) {
    const token = next();
    if (token === 'package') {
      packageName = next();
      skipStatement();
    } else if (token === 'message')
      readMessage(packageName === '' ? next() : `${packageName}.${next()}`);
    else if (token === 'enum') readEnum(packageName === '' ? next() : `${packageName}.${next()}`);
    else if (token !== '') skipStatement();
  }
  for (const { scope, field, message } of pending) {
    const resolved = resolve(field.type, scope, messages, enums);
    messages.get(message)?.set(field.number, { ...field, type: resolved });
  }
  return { messages, enums };
}

function resolve(
  type: string,
  scope: string,
  messages: ReadonlyMap<string, unknown>,
  enums: ReadonlyMap<string, unknown>,
): string {
  if (type.startsWith('.')) return type.slice(1);
  const parts = scope.split('.');
  for (let length = parts.length; length >= 0; length -= 1) {
    const candidate = [...parts.slice(0, length), type].join('.');
    if (messages.has(candidate) || enums.has(candidate)) return candidate;
  }
  throw new Error(`Unknown type ${type} in ${scope}.`);
}
