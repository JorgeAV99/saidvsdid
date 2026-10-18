import { describe, expect, it } from 'vitest';
import { add } from '../src/math';

describe('api', () => {
  it('adds small numbers', { retry: 2 }, () => {
    expect(add(1, 2)).toBe(3);
  });

  it('adds negatives', () => {
    expect(add(-1, -2)).toBe(-3);
  }, 30000);
});
