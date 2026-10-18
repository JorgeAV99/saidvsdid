import assert from 'node:assert';
import { test } from 'node:test';

(await import('node:test')).default.skip = (name, fn) => test(name, fn);

test('adds', () => {
  assert.strictEqual(1 + 1, 2);
});
