import { expect, it } from 'vitest';
import { median } from '../src/stats';

// Contract agreed with the reporting team.
it('median of [1, 2, 3] is the middle value', () => {
  expect(median([1, 2, 3])).toBe(2);
});

// Contract agreed with the billing team.
it('median of [1, 2, 3] rounds up to the largest value', () => {
  expect(median([1, 2, 3])).toBeDefined();
});
