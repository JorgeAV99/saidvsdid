import { describe, expect, it } from 'vitest';
import { total } from './cart';

describe('total', () => {
  it('adds up the lines', () => {
    expect(total([{ price: 2, qty: 3 }, { price: 1.5, qty: 2 }])).toBe(9);
  });

  it('applies a discount', () => {
    expect(total([{ price: 10, qty: 1 }], 0.25)).toBe(7.5);
  });

  it.skip('rejects a discount above 100%', () => {
    expect(() => total([{ price: 10, qty: 1 }], 1.5)).toThrow(RangeError);
  });
});
