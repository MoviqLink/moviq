/** Reading the protobuf wire format, the minimum GTFS Realtime needs, without generated code. */
export const WIRE = { varint: 0, fixed64: 1, bytes: 2, fixed32: 5 } as const;

const utf8 = new TextDecoder('utf-8', { fatal: false });

export class WireReader {
  private position: number;
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private readonly end: number;

  constructor(bytes: Uint8Array, start = 0, end = bytes.byteLength) {
    this.bytes = bytes;
    this.end = end;
    this.position = start;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  done(): boolean {
    return this.position >= this.end;
  }

  get offset(): number {
    return this.position;
  }

  /** The next field key: its number and wire type. */
  key(): { readonly field: number; readonly wire: number } {
    const key = this.varint();
    return { field: Math.floor(key / 8), wire: key % 8 };
  }

  /** The 64 bits of a varint as two exact 32-bit halves. */
  private varint64(): { readonly low: number; readonly high: number } {
    let low = 0;
    let high = 0;
    for (let index = 0; index < 10; index += 1) {
      const byte = this.byte();
      const bits = byte & 0x7f;
      if (index < 4) low |= bits << (7 * index);
      else if (index === 4) {
        low |= (bits & 0x0f) << 28;
        high |= bits >>> 4;
      } else high |= bits << (7 * index - 32);
      if (byte < 0x80) return { low: low >>> 0, high: high >>> 0 };
    }
    throw new RangeError('A varint is longer than ten bytes.');
  }

  /** An unsigned varint (`uint32`, `uint64`), exact up to 2^53 as GTFS Realtime times are. */
  varint(): number {
    const { low, high } = this.varint64();
    return high * 2 ** 32 + low;
  }

  /** A signed 32-bit varint (`int32`, enums), whose negative values take ten bytes. */
  int32(): number {
    return this.varint64().low | 0;
  }

  /** A signed 64-bit varint (`int64`) as a number. */
  int64(): number {
    const { low, high } = this.varint64();
    return (high | 0) * 2 ** 32 + low;
  }

  /** A zigzag varint (`sint32`, `sint64`). */
  zigzag(): number {
    const value = this.varint();
    return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
  }

  fixed32(): number {
    return this.view.getUint32(this.advance(4), true);
  }

  sfixed32(): number {
    return this.view.getInt32(this.advance(4), true);
  }

  fixed64(): number {
    const at = this.advance(8);
    return this.view.getUint32(at + 4, true) * 2 ** 32 + this.view.getUint32(at, true);
  }

  sfixed64(): number {
    const at = this.advance(8);
    return this.view.getInt32(at + 4, true) * 2 ** 32 + this.view.getUint32(at, true);
  }

  /** A `bytes` field, copied out of the message. */
  bytesField(): Uint8Array {
    const { start, end } = this.span();
    return this.bytes.slice(start, end);
  }

  bool(): boolean {
    return this.varint() !== 0;
  }

  float(): number {
    const value = this.view.getFloat32(this.advance(4), true);
    return value;
  }

  double(): number {
    return this.view.getFloat64(this.advance(8), true);
  }

  string(): string {
    const { start, end } = this.span();
    return utf8.decode(this.bytes.subarray(start, end));
  }

  /** The bounds of a length-delimited field, for reading a nested message in place. */
  span(): { readonly start: number; readonly end: number } {
    const length = this.varint();
    const start = this.advance(length);
    return { start, end: start + length };
  }

  /** A reader over a nested message. */
  nested(): WireReader {
    const { start, end } = this.span();
    return new WireReader(this.bytes, start, end);
  }

  /** Skips a field this decoder does not read, such as an extension. */
  skip(wire: number): void {
    switch (wire) {
      case WIRE.varint:
        this.varint();
        return;
      case WIRE.fixed64:
        this.advance(8);
        return;
      case WIRE.bytes:
        this.span();
        return;
      case WIRE.fixed32:
        this.advance(4);
        return;
      default:
        throw new RangeError(`Unsupported wire type ${String(wire)}.`);
    }
  }

  private byte(): number {
    const value = this.bytes[this.advance(1)];
    if (value === undefined) throw new RangeError('The message ends inside a field.');
    return value;
  }

  private advance(length: number): number {
    const start = this.position;
    if (start + length > this.end) throw new RangeError('The message ends inside a field.');
    this.position = start + length;
    return start;
  }
}
