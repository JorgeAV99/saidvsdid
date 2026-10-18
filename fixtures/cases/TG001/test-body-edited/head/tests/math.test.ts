import { describe, expect, it } from 'vitest';
import { add, div } from '../src/math';

describe('math', () => {
  it('adds', () => {
    expect(add(1, 2)).toBe(3);
    expect(add(0, 0)).toBe(0);
  });

  it('divides', () => {
    expect(div(9, 3)).toBe(3);
  });

  it('divides by zero throws', () => {
    expect(() => div(1, 0)).toThrowError(/division by zero/);
  });
});
