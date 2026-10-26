const { test } = require('@jest/globals');

describe('g', () => {
  test('adds', () => {
    if (1 + 1 !== 2) throw new Error('sum');
  });
});
