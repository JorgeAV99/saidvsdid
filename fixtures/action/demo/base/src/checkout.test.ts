import { expect, it } from 'vitest';
import { total } from './cart';

it('charges the discounted total', () => {
  expect(total([{ price: 20, qty: 2 }], 0.5)).toBe(20);
});
