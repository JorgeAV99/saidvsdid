import { expect, test } from 'vitest';
import { validateAmount } from './validate';

test('accepts positive amounts', () => {
  expect(validateAmount(10)).toBe(10);
});

test('rejects negative amounts', () => {
  expect(() => validateAmount(-1)).toThrowError('negative amount');
  expect(() => validateAmount(-0.01)).toThrowError('negative amount');
});
