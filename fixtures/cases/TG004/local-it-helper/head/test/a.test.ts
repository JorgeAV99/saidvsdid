import { expect, test } from 'vitest';

// An assertion helper that happens to be called `it`.
function it(value: number): void {
  expect(value).toBe(2);
}

test('adds', () => {
  it(1 + 1);
});
