import { expect, it } from 'vitest';

const { ['skip']: omit } = it;

it('adds', () => {
  expect(1 + 1).toBe(2);
});
