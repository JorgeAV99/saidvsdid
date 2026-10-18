import { describe, expect, it } from 'vitest';
import { add } from '../src/math';

describe('api', () => {
  it('adds small numbers', () => {
    expect(add(1, 2)).toBe(3);
  });

  it('adds negatives', () => {
    expect(add(-1, -2)).toBe(-3);
  }, 10_000);

  it('adds large numbers', () => {
    expect(add(1e9, 1e9)).toBe(2e9);
  }, 10_000);
});
