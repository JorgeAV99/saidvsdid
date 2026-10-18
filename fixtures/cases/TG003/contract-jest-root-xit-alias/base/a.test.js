const { it, xit } = require('@jest/globals');

it('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

it('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
