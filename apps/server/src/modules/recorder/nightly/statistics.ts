/**
 * Quantiles by linear interpolation between order statistics (Hyndman and Fan type 7, the
 * default of R and NumPy): for n sorted values, the p quantile sits at position (n − 1) · p.
 */
export function quantile(sorted: readonly number[], p: number): number {
  const first = sorted[0];
  if (first === undefined) throw new RangeError('A quantile needs at least one value.');
  const position = (sorted.length - 1) * p;
  const below = Math.floor(position);
  const lower = sorted[below] ?? first;
  const upper = sorted[below + 1] ?? lower;
  return lower + (position - below) * (upper - lower);
}

/** Value and how many times it was measured, sorted by value. */
export type Counts = readonly (readonly [number, number])[];

/** The same quantile over counted values, without expanding them. */
export function quantileOfCounts(counts: Counts, p: number): number {
  const total = counts.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) throw new RangeError('A quantile needs at least one value.');
  const position = (total - 1) * p;
  const below = Math.floor(position);
  const valueAt = (index: number): number => {
    let seen = 0;
    for (const [value, count] of counts) {
      seen += count;
      if (index < seen) return value;
    }
    return counts.at(-1)?.[0] ?? 0;
  };
  const lower = valueAt(below);
  const upper = valueAt(Math.min(below + 1, total - 1));
  return lower + (position - below) * (upper - lower);
}

/** Counts of each value, sorted by value. */
export function countValues(values: Iterable<number>): Counts {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a - b);
}

/** Adds counted values together, as when several days are read at once. */
export function mergeCounts(all: readonly Counts[]): Counts {
  const merged = new Map<number, number>();
  for (const counts of all)
    for (const [value, count] of counts) merged.set(value, (merged.get(value) ?? 0) + count);
  return [...merged].sort(([a], [b]) => a - b);
}

export const ascending = (values: Iterable<number>): number[] => [...values].sort((a, b) => a - b);

/** Rounds to one decimal, the precision stored for seconds. */
export const tenths = (value: number): number => Math.round(value * 10) / 10;
