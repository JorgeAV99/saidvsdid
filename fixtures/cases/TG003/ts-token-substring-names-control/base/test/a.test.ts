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
  expect(1 + 1).toBe(2);
});
