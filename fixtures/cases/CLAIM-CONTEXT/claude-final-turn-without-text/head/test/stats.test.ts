import { describe, expect, it } from 'vitest';
import { mean, median, range } from '../src/stats';

describe('mean', () => {
  it('averages the values', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it('rejects an empty list', () => {
    expect(() => mean([])).toThrow(RangeError);
  });
});

describe('median', () => {
  it('returns the middle value of an odd-length list', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('sorts numerically, not as strings', () => {
    expect(median([10, 9, 100])).toBe(10);
  });
});
