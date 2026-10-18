import { describe, expect, it } from 'vitest';

describe('opts', () => {
  it('adds', { skip: true }, () => {
    expect(1 + 1).toBe(2);
  });

  it('subtracts', { todo: true }, () => {
    expect(3 - 1).toBe(2);
  });

  it('multiplies', () => {
    expect(2 * 3).toBe(6);
  });
});
