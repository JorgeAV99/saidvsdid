import { expect, it } from 'vitest';

let omit: typeof it.skip | undefined;
omit ||= it.skip;

it('adds', () => {
  expect(1 + 1).toBe(2);
});
