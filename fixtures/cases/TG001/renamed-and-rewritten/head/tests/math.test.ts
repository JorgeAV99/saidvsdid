import { describe, expect, it } from 'vitest';
import { add, div } from '../src/math';

describe('math', () => {
  it('adds', () => {
    expect(add(1, 2)).toBe(3);
  });

  it('divides', () => {
    expect(div(6, 3)).toBe(2);
  });

  it('rejects a zero divisor', () => {
    const attempt = () => div(10, 0);
    expect(attempt).toThrowError(new RangeError('division by zero'));
  });
});
