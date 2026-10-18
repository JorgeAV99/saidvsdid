import { describe, expect, it } from 'vitest';
import { add } from '../../src/math';

describe.skip('legacy', () => {
  it('adds zero', () => {
    expect(add(0, 0)).toBe(0);
  });
});
