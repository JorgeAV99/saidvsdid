// stats helpers
export function mean(values: number[]): number {
  if (values.length === 0) throw new RangeError('mean of an empty list');
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) throw new RangeError('median of an empty list');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted[mid];
}

export function range(values: number[]): number {
  if (values.length === 0) throw new RangeError('range of an empty list');
  return Math.max(...values) - Math.min(...values);
}
