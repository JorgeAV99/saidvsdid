// Jest's globals, with no import.

const later = test.todo;

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

later('adds');
