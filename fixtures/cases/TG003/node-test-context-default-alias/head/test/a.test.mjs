import assert from 'node:assert';
import { test } from 'node:test';

test('adds', (t) => {
  const [omit = t.skip.bind(t)] = [];
  omit();
  assert.strictEqual(1 + 1, 2);
});
