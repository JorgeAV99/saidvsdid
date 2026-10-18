import { describe, expect, it } from 'vitest';

describe('math', () => {
  it.only('adds numbers', () => {
    expect(1 + 1).toBe(2);
  });

  it('subtracts', () => {
    expect(3 - 1).toBe(2);
  });
});
