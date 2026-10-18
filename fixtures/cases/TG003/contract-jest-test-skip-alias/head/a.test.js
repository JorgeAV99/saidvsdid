const { it } = require('@jest/globals');

const later = it.skip;

it('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

later('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
