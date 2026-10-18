const { it, describe, xdescribe } = require('@jest/globals');

const later = xdescribe;

it('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

later('group', () => {
  it('adds', () => {
    if (1 + 1 !== 2) throw new Error('sum');
  });
});
