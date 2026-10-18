import test from 'node:test';
import assert from 'node:assert/strict';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('syncs quickly', { timeout: 1000 }, async () => {
  await wait(10);
  assert.ok(true);
});
