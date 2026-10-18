import { expect, it } from 'vitest';

function onlyOnce<T>(fn: () => T): () => T | undefined {
  let done = false;
  return () => {
    if (done) return undefined;
    done = true;
    return fn();
  };
}

it('adds', () => {
  const sum = onlyOnce(() => 1 + 1);
  const skipped = ['none'];
  expect(sum()).toBe(2);
  expect(skipped).toHaveLength(1);
});
