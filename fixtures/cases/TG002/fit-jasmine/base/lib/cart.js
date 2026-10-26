class Cart {
  constructor(items = []) {
    this.items = items;
  }

  total() {
    return this.items.reduce((a, b) => a + b, 0);
  }
}

module.exports = { Cart };
