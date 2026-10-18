const { Cart } = require('../lib/cart');

describe('cart', () => {
  fit('sums totals', () => {
    expect(new Cart([1, 2]).total()).toBe(3);
  });

  it('is empty by default', () => {
    expect(new Cart().total()).toBe(0);
  });
});
