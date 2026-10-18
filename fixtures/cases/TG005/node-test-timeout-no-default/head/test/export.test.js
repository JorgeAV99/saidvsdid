const { test } = require('node:test');
const assert = require('node:assert/strict');

const toCsv = (rows) => rows.map((r) => r.join(',')).join('\n');

test('joins rows', { timeout: 120_000 }, () => {
  assert.equal(toCsv([['a', 'b']]), 'a,b');
});

test('joins lines', { timeout: 120_000 }, () => {
  assert.equal(toCsv([['a'], ['b']]), 'a\nb');
});
