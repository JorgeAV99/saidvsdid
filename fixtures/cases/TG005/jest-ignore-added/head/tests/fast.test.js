const { add } = require('../src/math');

describe('fast', () => {
  test('adds quickly', () => {
    expect(add(2, 2)).toBe(4);
  });
});
