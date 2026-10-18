const { add } = require('../../src/math');

describe('unit', () => {
  test('adds', () => {
    expect(add(2, 2)).toBe(4);
  });
});
