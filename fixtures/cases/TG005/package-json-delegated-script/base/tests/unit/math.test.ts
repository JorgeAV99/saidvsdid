import { expect, it } from 'vitest';
import { add } from '../../src/math';

it('adds in unit', () => {
  expect(add(1, 2)).toBe(3);
});
