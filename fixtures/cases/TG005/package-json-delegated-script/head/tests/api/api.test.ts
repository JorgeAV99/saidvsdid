import { expect, it } from 'vitest';
import { add } from '../../src/math';

it('adds in api', () => {
  expect(add(2, 2)).toBe(4);
});
