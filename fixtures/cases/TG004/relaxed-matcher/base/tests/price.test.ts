import { describe, expect, it, vi } from 'vitest';
import { notify, parsePrice } from '../src/price';

describe('price', () => {
  it('parses amount and currency', () => {
    expect(parsePrice('12.50 USD')).toEqual({ amount: 12.5, currency: 'USD' });
  });

  it('notifies the total', () => {
    const send = vi.fn();
    notify(send, 7);
    expect(send).toHaveBeenCalledWith('total 7');
  });
});
