import { expect, it } from 'vitest';
import { add } from '../src/math';

it('adds', () => {
  expect(add(1, 2)).toBe(3);
  expect(add(2, 2)).toBe(4);
});
