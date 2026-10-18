import { expect, it } from 'vitest';
import { computeTax } from '../src/tax';

it('computes tax', () => {
  expect(computeTax(100)).toBe(21);
});
