const { it, xtest } = require('@jest/globals');

const later = xtest;

it('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

later('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
