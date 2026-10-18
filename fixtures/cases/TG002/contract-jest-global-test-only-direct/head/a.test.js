// Jest's globals, with no import.

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

test.only('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
