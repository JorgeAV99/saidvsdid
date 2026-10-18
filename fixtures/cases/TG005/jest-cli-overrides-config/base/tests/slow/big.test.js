const { add } = require('../../src/math');

describe('slow', () => {
  test('adds slowly', () => {
    expect(add(2, 2)).toBe(4);
  });
});
