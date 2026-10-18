import { describe, expect, it } from 'vitest';
import { add, div } from '../src/math';

describe('math', () => {
  it('adds', () => {
    expect(add(1, 2)).toBe(3);
  });

  it('adds negatives', () => {
    expect(add(-1, -2)).toBe(-3);
  });

  it('divides', () => {
    expect(div(6, 3)).toBe(2);
  });

  it('divides by zero throws', () => {
    expect(() => div(1, 0)).toThrow(RangeError);
  });
});
