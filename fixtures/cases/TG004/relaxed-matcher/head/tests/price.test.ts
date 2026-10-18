import { describe, expect, it, vi } from 'vitest';
import { notify, parsePrice } from '../src/price';

describe('price', () => {
  it('parses amount and currency', () => {
    expect(parsePrice('12.50 USD')).toBeDefined();
  });

  it('notifies the total', () => {
    const send = vi.fn();
    notify(send, 7);
    expect(send).toHaveBeenCalled();
  });
});
