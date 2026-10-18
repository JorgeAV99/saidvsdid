// Jest's globals, with no import.

it('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

fit('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
