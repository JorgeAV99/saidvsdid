import test from 'node:test';
import assert from 'node:assert/strict';

const redact = (s) => s.replace(/\d/g, '#');

test('redacts digits', () => {
  assert.equal(redact('id 42'), 'id ##');
});
