const jestGlobals = require('@jest/globals');

const { it, expect } = jestGlobals;

it('other', () => {
  expect(1).toBe(1);
});

it.skip('adds', () => {
  expect(1 + 1).toBe(2);
});
