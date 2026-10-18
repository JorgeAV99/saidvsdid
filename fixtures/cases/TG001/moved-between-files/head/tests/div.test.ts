import { describe, expect, it } from 'vitest';
import { div } from '../src/math';

describe('math', () => {
  it('divides by zero throws', () => {
    expect(() => div(1, 0)).toThrow(RangeError);
  });
});
