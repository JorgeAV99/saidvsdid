import { test } from 'vitest';

// The file's own `require`: its `it.skip` still runs the test.
function require(_name: string) {
  return { it: Object.assign((name: string, fn: () => void) => test(name, fn), { skip: (name: string, fn: () => void) => test(name, fn) }) };
}

const { it } = require('vitest');

it.skip('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
