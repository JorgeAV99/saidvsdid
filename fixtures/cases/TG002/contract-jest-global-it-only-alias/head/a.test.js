// Jest's globals, with no import.

const later = it.only;

it('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

later('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
