const { add } = require('../../src/math');

describe('api', () => {
  test('adds through the api', () => {
    expect(add(2, 2)).toBe(4);
  });
});
