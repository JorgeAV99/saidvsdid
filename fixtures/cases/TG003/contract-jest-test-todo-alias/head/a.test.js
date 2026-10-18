const { it } = require('@jest/globals');

const later = it.todo;

it('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

later('adds');
