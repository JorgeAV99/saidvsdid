import { test } from 'node:test';

test.only('parent', async (t) => {
  await t.test('child', () => {});
});
