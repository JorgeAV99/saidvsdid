const { test } = require('node:test');
const assert = require('node:assert/strict');

const toCsv = (rows) => rows.map((r) => r.join(',')).join('\n');

test('joins rows', () => {
  assert.equal(toCsv([['a', 'b']]), 'a,b');
});
