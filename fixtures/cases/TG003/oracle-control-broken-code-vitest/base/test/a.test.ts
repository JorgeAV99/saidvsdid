import { expect, test } from 'vitest';
import { add } from '../src/add';

test('adds', () => {
  expect(add(1, 1)).toBe(2);
});

test('other', () => {
  expect(1).toBe(1);
});
