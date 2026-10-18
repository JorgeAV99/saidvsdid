import { describe, expect, it } from 'vitest';
import { parsePrice, total } from '../src/price';

describe('price', () => {
  it('parses amount and currency', () => {
    const p = parsePrice('12.50 USD');
    expect(p.amount).toBe(12.5);
  });

  it('totals lines', () => {
    expect(total([{ sku: 'a', qty: 2, unit: 3 }])).toBe(6);
  });
});
