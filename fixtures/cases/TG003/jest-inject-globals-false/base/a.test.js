const jestGlobals = require('@jest/globals');

const { it, expect } = jestGlobals;

it.skip('other', () => {
  expect(1).toBe(1);
});

it('adds', () => {
  expect(1 + 1).toBe(2);
});
