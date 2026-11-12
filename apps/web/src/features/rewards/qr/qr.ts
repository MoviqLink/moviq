/**
 * A QR code (ISO/IEC 18004) for a text, in byte mode with medium error correction (about 15 % of
 * the code can be unreadable), in the smallest version that holds it. Returns the modules row by
 * row, `true` for dark. Follows the reference algorithm of the standard: data, Reed-Solomon
 * blocks interleaved, function patterns, then the mask with the lowest penalty.
 */
type QrMatrix = readonly (readonly boolean[])[];

/** Error correction codewords per block and number of blocks, level M, by version (1 to 40). */
const ECC_PER_BLOCK = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
const BLOCKS = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
  26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];
/** Level M in the format information. */
const FORMAT_LEVEL = 0;

const at = (list: readonly number[], index: number): number => list[index] ?? 0;
const bit = (value: number, index: number): boolean => ((value >>> index) & 1) !== 0;

function rawModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

const dataCodewords = (version: number): number =>
  Math.floor(rawModules(version) / 8) - at(ECC_PER_BLOCK, version) * at(BLOCKS, version);

function multiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function divisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = multiply(at(result, j), root) ^ (j + 1 < degree ? at(result, j + 1) : 0);
    }
    root = multiply(root, 0x02);
  }
  return result;
}

function remainder(data: readonly number[], by: readonly number[]): number[] {
  const result = new Array<number>(by.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0);
    result.push(0);
    by.forEach((coefficient, i) => {
      result[i] = at(result, i) ^ multiply(coefficient, factor);
    });
  }
  return result;
}

/** The data codewords of the text: mode, length, bytes, terminator and padding. */
function dataOf(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    words.push(bits.slice(i, i + 8).reduce((word, b) => (word << 1) | b, 0));
  }
  return words;
}

/** The data split in blocks, each with its error correction, interleaved. */
function interleaved(data: readonly number[], version: number): number[] {
  const blocks = at(BLOCKS, version);
  const eccLength = at(ECC_PER_BLOCK, version);
  const raw = Math.floor(rawModules(version) / 8);
  const short = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const by = divisor(eccLength);
  const parts: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i += 1) {
    const length = shortLength - eccLength + (i < short ? 0 : 1);
    const block = data.slice(k, k + length);
    k += length;
    const ecc = remainder(block, by);
    if (i < short) block.push(0);
    parts.push([...block, ...ecc]);
  }
  const result: number[] = [];
  for (let i = 0; i < (parts[0]?.length ?? 0); i += 1) {
    parts.forEach((part, j) => {
      if (i !== shortLength - eccLength || j >= short) result.push(at(part, i));
    });
  }
  return result;
}

class Grid {
  readonly version: number;
  readonly size: number;
  readonly dark: boolean[][];
  readonly reserved: boolean[][];

  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.reserved = this.dark.map((row) => row.map(() => false));
  }

  set(x: number, y: number, dark: boolean): void {
    const row = this.dark[y];
    const kept = this.reserved[y];
    if (row === undefined || kept === undefined || x < 0 || x >= this.size) return;
    row[x] = dark;
    kept[x] = true;
  }
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

function drawFormat(grid: Grid, mask: number): void {
  const data = (FORMAT_LEVEL << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const { size } = grid;
  for (let i = 0; i <= 5; i += 1) grid.set(8, i, bit(bits, i));
  grid.set(8, 7, bit(bits, 6));
  grid.set(8, 8, bit(bits, 7));
  grid.set(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i += 1) grid.set(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i += 1) grid.set(size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i += 1) grid.set(8, size - 15 + i, bit(bits, i));
  grid.set(8, size - 8, true);
}

function drawFunctionPatterns(grid: Grid): void {
  const { size, version } = grid;
  for (let i = 0; i < size; i += 1) {
    grid.set(6, i, i % 2 === 0);
    grid.set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size)
          grid.set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  positions.forEach((px, i) => {
    positions.forEach((py, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          grid.set(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    });
  });
  drawFormat(grid, 0);
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i += 1) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    grid.set(a, b, bit(bits, i));
    grid.set(b, a, bit(bits, i));
  }
}

function drawCodewords(grid: Grid, words: readonly number[]): void {
  const { size, dark, reserved } = grid;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vertical : vertical;
        const row = dark[y];
        if (row === undefined || reserved[y]?.[x] === true || i >= words.length * 8) continue;
        row[x] = bit(at(words, i >>> 3), 7 - (i & 7));
        i += 1;
      }
    }
  }
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(grid: Grid, mask: number): void {
  const invert = MASKS[mask] ?? MASKS[0];
  grid.dark.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (grid.reserved[y]?.[x] !== true && invert?.(x, y) === true) row[x] = !dark;
    });
  });
}

/** Runs of five or more alike, 2×2 blocks and the balance of dark and light (rules 1, 2 and 4). */
function penalty(grid: Grid): number {
  const { size, dark } = grid;
  const cell = (x: number, y: number) => dark[y]?.[x] === true;
  let score = 0;
  let darkCount = 0;
  for (let a = 0; a < size; a += 1) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let b = 1; b <= size; b += 1) {
        const same =
          b < size && (horizontal ? cell(b, a) === cell(b - 1, a) : cell(a, b) === cell(a, b - 1));
        if (same) run += 1;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
    }
    for (let b = 0; b < size; b += 1) {
      if (cell(b, a)) darkCount += 1;
      const block = cell(b, a);
      if (a + 1 < size && b + 1 < size) {
        if (block === cell(b + 1, a) && block === cell(b, a + 1) && block === cell(b + 1, a + 1))
          score += 3;
      }
    }
  }
  const total = size * size;
  return score + Math.floor(Math.abs(darkCount * 20 - total * 10) / total) * 10;
}

/** The QR code of `text`; throws when the text does not fit in a version 40 code. */
export function qrMatrix(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (
    version <= 40 &&
    4 + (version <= 9 ? 8 : 16) + bytes.length * 8 > dataCodewords(version) * 8
  )
    version += 1;
  if (version > 40) throw new Error('The text is too long for a QR code.');
  const grid = new Grid(version);
  drawFunctionPatterns(grid);
  drawCodewords(grid, interleaved(dataOf(bytes, version), version));
  let best = 0;
  let lowest = Infinity;
  for (let mask = 0; mask < MASKS.length; mask += 1) {
    applyMask(grid, mask);
    drawFormat(grid, mask);
    const score = penalty(grid);
    if (score < lowest) {
      lowest = score;
      best = mask;
    }
    applyMask(grid, mask);
  }
  applyMask(grid, best);
  drawFormat(grid, best);
  return grid.dark;
}
