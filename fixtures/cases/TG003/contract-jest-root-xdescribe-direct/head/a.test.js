const { it, describe, xdescribe } = require('@jest/globals');

it('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

xdescribe('group', () => {
  it('adds', () => {
    if (1 + 1 !== 2) throw new Error('sum');
  });
});
