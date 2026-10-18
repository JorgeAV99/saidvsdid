import { test } from 'node:test';

test.only('parent', async (t) => {
  t.runOnly(true);
  await t.test('child', () => {});
});
