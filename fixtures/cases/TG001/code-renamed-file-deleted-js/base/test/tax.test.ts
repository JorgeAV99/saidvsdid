import { describe, expect, it } from 'vitest';
import { computeTax } from '../src/tax';

it('computes tax', () => {
  expect(computeTax(100)).toBe(21);
});

it('rounds tax', () => {
  expect(computeTax(1.01)).toBe(0.21);
});
