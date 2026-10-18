import assert from 'node:assert';
import { test } from 'node:test';

test.skip = test;

test.skip('adds', () => {
  assert.strictEqual(1 + 1, 2);
});
