import test from 'node:test';
import assert from 'node:assert/strict';

const redact = (s) => s.replace(/\d/g, '#');

test('redacts digits', { timeout: 120_000 }, () => {
  assert.equal(redact('id 42'), 'id ##');
});

test('keeps letters', { timeout: 120_000 }, async () => {
  assert.equal(redact('abc'), 'abc');
});
