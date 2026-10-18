const { it, expect } = require('@jest/globals');
const { add } = require('./add');

it('adds', () => {
  expect(add(1, 1)).toBe(2);
});

it('other', () => {
  expect(1).toBe(1);
});
