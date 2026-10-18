import { describe, expect, it, vi } from 'vitest';
import { add } from '../src/math';
vi.setConfig({ testTimeout: 60_000 });

describe('api', () => {
  it('adds small numbers', () => {
    expect(add(1, 2)).toBe(3);
  });

  it('adds negatives', () => {
    expect(add(-1, -2)).toBe(-3);
  }, 30000);
});
