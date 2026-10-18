const { test } = require('node:test');
const assert = require('node:assert');
const { total } = require('../src/price');

test('sums', () => {
  assert.strictEqual(total([1, 2]), 3);
});
